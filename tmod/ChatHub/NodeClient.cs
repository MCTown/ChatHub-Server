using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace ChatHub;

public sealed class NodeClient : IDisposable
{
    public sealed record Work(ClientWebSocket Socket, JsonElement Frame);
    private sealed record Outbound(ClientWebSocket Socket, object Frame);
    private readonly NodeSettings settings;
    private readonly Action<string> log;
    private readonly CancellationTokenSource stop = new();
    private readonly Channel<Outbound> outbox = Channel.CreateBounded<Outbound>(1000);
    private readonly ConcurrentQueue<Work> gameWork = new();
    private readonly ConcurrentDictionary<long, string> users = new();
    private ClientWebSocket? registered;
    private Task? runner;
    private int workCount;
    public NodeClient(NodeSettings settings, Action<string> log) { this.settings = settings; this.log = log; }
    public void Start() => runner = Task.Run(ConnectLoop);
    public bool TryTake(out Work? work)
    {
        if (!gameWork.TryDequeue(out work)) return false;
        Interlocked.Decrement(ref workCount);
        return true;
    }
    public bool IsCurrent(Work work) => ReferenceEquals(Volatile.Read(ref registered), work.Socket);
    public string UserName(long id) => users.TryGetValue(id, out var name) ? name : id.ToString();
    private bool Enqueue(ClientWebSocket socket, object frame)
    {
        if (stop.IsCancellationRequested || !ReferenceEquals(Volatile.Read(ref registered), socket)) return false;
        if (outbox.Writer.TryWrite(new Outbound(socket, frame))) return true;
        log("ChatHub outbox full; dropped frame");
        socket.Abort(); // API/ACK drops must not leave an apparently healthy session.
        return false;
    }
    public bool Emit(object frame)
    {
        var socket = Volatile.Read(ref registered);
        return socket != null && Enqueue(socket, frame);
    }
    public void Reply(Work work, object frame) => Enqueue(work.Socket, frame);
    public void Chat(PlayerIdentity player, string text) => Emit(new { type = "chat", event_id = Guid.NewGuid().ToString("N"), player,
        segments = new[] { new { type = "text", text = Limit(text, 16000) } } });
    public void System(string kind, string text) => Emit(new { type = "system", event_id = Guid.NewGuid().ToString("N"), kind, text = Limit(text, 16000) });
    public static string Limit(string text, int max)
    {
        if (text.Length <= max) return text;
        if (max > 0 && char.IsHighSurrogate(text[max - 1]) && char.IsLowSurrogate(text[max])) max--;
        return text[..max];
    }

    private async Task ConnectLoop()
    {
        while (!stop.IsCancellationRequested)
        {
            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("Authorization", "Bearer " + settings.Password);
            socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
            using var session = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
            Task? sender = null;
            try
            {
                using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(session.Token))
                {
                    timeout.CancelAfter(TimeSpan.FromSeconds(10));
                    await socket.ConnectAsync(new Uri(settings.ServerUrl), timeout.Token);
                    await Send(socket, new { type = "hello", version = 2, node_id = settings.NodeId, name = settings.Name,
                        identity_scope = settings.IdentityScope }, timeout.Token);
                    var first = await Receive(socket, timeout.Token);
                    if (first.GetProperty("type").GetString() != "registered" || first.GetProperty("version").GetInt32() != 2)
                        throw new InvalidDataException("ChatHub registration rejected");
                    users.Clear();
                    if (first.TryGetProperty("system_user", out var user)) users[user.GetProperty("user_id").GetInt64()] = user.GetProperty("name").GetString()!;
                    Volatile.Write(ref registered, socket);
                    log("ChatHub connected, group " + first.GetProperty("group_id").GetInt64());
                }
                sender = SendLoop(socket, session.Token);
                // A sender failure must also release a receiver blocked on network IO.
                _ = sender.ContinueWith(_ => socket.Abort(), CancellationToken.None, TaskContinuationOptions.OnlyOnFaulted, TaskScheduler.Default);
                while (!session.IsCancellationRequested)
                {
                    var frame = await Receive(socket, session.Token);
                    switch (frame.GetProperty("type").GetString())
                    {
                        case "users":
                            foreach (var user in frame.GetProperty("users").EnumerateArray()) users[user.GetProperty("user_id").GetInt64()] = user.GetProperty("name").GetString()!;
                            break;
                        case "accepted": users[frame.GetProperty("user_id").GetInt64()] = frame.GetProperty("name").GetString()!; break;
                        case "api_call":
                        case "deliver":
                            if (Interlocked.Increment(ref workCount) > 100) { Interlocked.Decrement(ref workCount); throw new InvalidDataException("Game work queue full"); }
                            gameWork.Enqueue(new Work(socket, frame));
                            break;
                        case "error": log("ChatHub rejected a protocol frame"); break;
                    }
                }
            }
            catch (Exception error) when (!stop.IsCancellationRequested) { log("ChatHub connection interrupted: " + error.GetType().Name); }
            catch (OperationCanceledException) { }
            finally
            {
                Volatile.Write(ref registered, null);
                session.Cancel();
                socket.Abort();
                if (sender != null) { try { await sender; } catch (Exception) { } }
                while (outbox.Reader.TryRead(out _)) { }
                while (TryTake(out _)) { }
            }
            try { await Task.Delay(TimeSpan.FromSeconds(settings.ReconnectSeconds), stop.Token); }
            catch (OperationCanceledException) { break; }
        }
    }
    private async Task SendLoop(ClientWebSocket socket, CancellationToken token)
    {
        while (await outbox.Reader.WaitToReadAsync(token))
            while (outbox.Reader.TryRead(out var item))
                if (ReferenceEquals(item.Socket, socket))
                {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
                    timeout.CancelAfter(TimeSpan.FromSeconds(5));
                    await Send(socket, item.Frame, timeout.Token);
                }
    }
    private static Task Send(ClientWebSocket socket, object frame, CancellationToken token) =>
        socket.SendAsync(new ArraySegment<byte>(JsonSerializer.SerializeToUtf8Bytes(frame)), WebSocketMessageType.Text, true, token);
    private static async Task<JsonElement> Receive(ClientWebSocket socket, CancellationToken token)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(new ArraySegment<byte>(chunk), token);
            if (result.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Connection closed or non-text frame");
            if (buffer.Length + result.Count > 1024 * 1024) throw new InvalidDataException("Frame too large");
            buffer.Write(chunk, 0, result.Count);
        } while (!result.EndOfMessage);
        using var document = JsonDocument.Parse(buffer.ToArray());
        return document.RootElement.Clone();
    }
    public void Dispose()
    {
        stop.Cancel();
        Volatile.Read(ref registered)?.Abort();
        try { runner?.Wait(TimeSpan.FromSeconds(2)); } catch (AggregateException) { }
        // Token source stays alive until its background runner has finished.
        if (runner == null || runner.IsCompleted) stop.Dispose();
    }
}
