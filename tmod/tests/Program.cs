using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using ChatHub;

static void Check(bool condition, string message)
{ if (!condition) throw new Exception(message); }
var alice = PlayerIdentity.FromName("小明 One");
var bob = PlayerIdentity.FromName("Bob");
var idle = PlayerIdentity.FromName("旁观者");
Check(alice == PlayerIdentity.FromName("小明 One"), "Identity must survive reconnect");
Check(alice.uuid != PlayerIdentity.FromName("小明 one").uuid, "Character names are case sensitive");
Check(alice.uuid.Length == 32 && Guid.TryParseExact(alice.uuid, "N", out _), "Native UUID format");
Check(NodeClient.Limit("a😀b", 2) == "a", "Truncation must not split emoji surrogate pairs");
var events = new List<(string Kind, string Text)>();
var tracker = new BossTracker((kind, text) => events.Add((kind, text)));
var root = new BossTracker.BossEntity("1:1", "boss", "测试 Boss", true);
var part = new BossTracker.BossEntity("2:2", "boss", "测试 Boss", false);
var roster = new[] { alice, bob, idle };
tracker.Update(new[] { root, part }, 0, roster);
tracker.Hit(root, alice, 60, 1, roster);
tracker.Hit(part, bob, 30, 2, roster);
tracker.Hit(root, null, 10, 3, roster);
tracker.Killed(part, 4, roster);
tracker.Update(new[] { root }, 124, roster);
Check(events.Count == 1, "Part death must not finish a battle");
tracker.Killed(root, 125, roster);
tracker.Update(Array.Empty<BossTracker.BossEntity>(), 245, roster);
Check(events.Count == 2 && events[1].Kind == "boss_defeat", "Boss defeat");
Check(events[1].Text.Contains("小明 One: 60（60.00%）") && events[1].Text.Contains("Bob: 30（30.00%）"), "Damage shares");
Check(events[1].Text.Contains("旁观者: 0（0.00%）") && events[1].Text.Contains("未归属伤害: 10（10.00%）"), "All players and unattributed damage");
tracker.Update(new[] { root }, 300, roster);
tracker.Update(Array.Empty<BossTracker.BossEntity>(), 420, roster);
Check(events[^1].Kind == "boss_escape", "Despawn is not victory");
tracker.Update(new[] { root }, 500, roster);
tracker.Killed(root, 501, roster);
tracker.Update(Array.Empty<BossTracker.BossEntity>(), 621, roster);
Check(events[^1].Kind == "boss_defeat" && events[^1].Text.Contains("伤害合计：0"), "No NaN on zero damage");
var twin = root with { Token = "3:3" };
tracker.Update(new[] { root, twin }, 700, roster);
tracker.Killed(root, 701, roster);
tracker.Update(new[] { twin }, 900, roster);
Check(events[^1].Kind == "boss_start", "Twins cannot finish after only one dies");
tracker.Update(Array.Empty<BossTracker.BossEntity>(), 1020, roster);
Check(events[^1].Kind == "boss_escape", "One twin fleeing is not victory");
var progress = new List<string>();
var progressTracker = new BossTracker((kind, _) => progress.Add(kind), 1);
progressTracker.Update(new[] { root }, 0, roster);
progressTracker.Update(new[] { root }, 60, roster);
Check(progress.SequenceEqual(new[] { "boss_start", "boss_progress" }), "Optional progress throttling");
var split = root with { Token = "split-head", Group = "eow" };
tracker.Update(new[] { split }, 1100, roster);
tracker.Killed(split with { Token = "last-segment", Terminal = false }, 1101, roster);
tracker.ConfirmDefeat("eow");
tracker.Update(Array.Empty<BossTracker.BossEntity>(), 1221, roster);
Check(events[^1].Kind == "boss_defeat", "Definitive last EoW segment death resolves transformed head tokens");
using (var document = JsonDocument.Parse("""{"authorName":"[c/fff:evil]","sourceGroupName":"跨服","segments":[{"type":"text","text":"[i:1] hello"},{"type":"mention","userId":123},{"type":"mention","userId":"all"},{"type":"image","url":"https://example.com/a.png"}]}"""))
{
    var rendered = DeliveryRenderer.Render(document.RootElement, _ => "小明");
    Check(rendered.Contains("［i:1］") && !rendered.Contains("[c/"), "Remote chat tags must be escaped");
    Check(rendered.Contains("@小明@所有人[图片] https://"), "Mentions and images rendered");
}
Console.WriteLine("PASS identities, boss accounting, defeat/escape, twins, progress, renderer");

var configDirectory = Path.Combine(Path.GetTempPath(), "chathub-config-test-" + Guid.NewGuid().ToString("N"));
var configPath = Path.Combine(configDirectory, "ChatHub.json");
var previousPassword = Environment.GetEnvironmentVariable("CHATHUB_NODE_PASSWORD");
try
{
    Environment.SetEnvironmentVariable("CHATHUB_NODE_PASSWORD", null);
    Check(!NodeSettings.Load(configPath).Enabled, "First run is disabled");
    if (!OperatingSystem.IsWindows()) Check(File.GetUnixFileMode(configPath) == (UnixFileMode.UserRead | UnixFileMode.UserWrite), "Secret file mode 0600");
    File.WriteAllText(configPath, JsonSerializer.Serialize(new NodeSettings { Enabled = true, Password = "secret" }));
    Check(NodeSettings.Load(configPath).Password == "secret", "Valid configuration");
    Environment.SetEnvironmentVariable("CHATHUB_NODE_PASSWORD", "env-secret");
    Check(NodeSettings.Load(configPath).Password == "env-secret", "Environment password override");
    var invalid = new NodeSettings { Enabled = true, Password = "secret", IdentityScope = "minecraft:online" };
    File.WriteAllText(configPath, JsonSerializer.Serialize(invalid));
    var rejected = false;
    try { NodeSettings.Load(configPath); } catch (InvalidDataException) { rejected = true; }
    Check(rejected, "Must not impersonate Minecraft UUID scope");
}
finally
{
    Environment.SetEnvironmentVariable("CHATHUB_NODE_PASSWORD", previousPassword);
    Directory.Delete(configDirectory, true);
}
Console.WriteLine("PASS safe config defaults, permissions, environment credential, scope validation");

// Real loopback WebSocket against the same C# client used by the mod.
using var allocator = new TcpListener(IPAddress.Loopback, 0);
allocator.Start();
var port = ((IPEndPoint)allocator.LocalEndpoint).Port;
allocator.Stop();
using var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
listener.Start();
var settings = new NodeSettings { Enabled = true, ServerUrl = $"ws://127.0.0.1:{port}/chathub/v2/connect", Password = "test-secret", ReconnectSeconds = 1 };
using var client = new NodeClient(settings, _ => { });
Check(!client.Emit(new { type = "system", text = "offline" }), "Offline events not queued");
client.Start();
using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
var context = await listener.GetContextAsync().WaitAsync(timeout.Token);
Check(context.Request.Headers["Authorization"] == "Bearer test-secret", "Upgrade authorization");
using var socket = (await context.AcceptWebSocketAsync(null)).WebSocket;
async Task<JsonElement> Receive()
{
    var buffer = new byte[65536];
    var result = await socket.ReceiveAsync(buffer.AsMemory(), timeout.Token);
    Check(result.EndOfMessage, "Test frame length");
    return JsonDocument.Parse(buffer.AsMemory(0, result.Count)).RootElement.Clone();
}
async Task Send(object frame) => await socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(frame).AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
var hello = await Receive();
Check(hello.GetProperty("version").GetInt32() == 2 && !hello.TryGetProperty("Password", out _), "v2 hello has no credentials");
var registrationBytes = JsonSerializer.SerializeToUtf8Bytes(new { type = "registered", version = 2, group_id = 123, system_user = new { user_id = 2, name = "Server" } });
await socket.SendAsync(registrationBytes.AsMemory(0, 10), WebSocketMessageType.Text, false, timeout.Token);
await socket.SendAsync(registrationBytes.AsMemory(10), WebSocketMessageType.Text, true, timeout.Token);
await Send(new { type = "api_call", request_id = "roster", action = "get_online_players" });
NodeClient.Work? work;
while (!client.TryTake(out work)) await Task.Delay(5, timeout.Token);
Check(work != null && client.IsCurrent(work), "Game thread API dispatch");
client.Reply(work!, new { type = "api_result", request_id = "roster", ok = true, players = roster });
var response = await Receive();
Check(response.GetProperty("players").GetArrayLength() == 3, "Online roster response");
await Send(new { type = "users", users = new[] { new { user_id = 10000, name = alice.name } } });
await Send(new { type = "deliver", request_id = "delivery", authorName = "ChatHub", segments = new[] { new { type = "text", text = "hello" } } });
while (!client.TryTake(out work)) await Task.Delay(5, timeout.Token);
Check(client.UserName(10000) == alice.name, "users mapping");
client.Reply(work!, new { type = "delivery_result", request_id = "delivery", ok = true });
Check((await Receive()).GetProperty("request_id").GetString() == "delivery", "Delivery ACK");
client.Chat(alice, "聊天");
Check((await Receive()).GetProperty("player").GetProperty("name").GetString() == alice.name, "Unicode chat frame");
client.System("death", "小明 One 死了");
Check((await Receive()).GetProperty("kind").GetString() == "death", "System frame");
await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "test reconnect", timeout.Token);
var nextContext = await listener.GetContextAsync().WaitAsync(timeout.Token);
using var next = (await nextContext.AcceptWebSocketAsync(null)).WebSocket;
var nextBuffer = new byte[65536];
await next.ReceiveAsync(nextBuffer.AsMemory(), timeout.Token);
await next.SendAsync(JsonSerializer.SerializeToUtf8Bytes(new { type = "registered", version = 2, group_id = 123 }).AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
await next.SendAsync(JsonSerializer.SerializeToUtf8Bytes(new { type = "api_call", request_id = "next", action = "get_online_players" }).AsMemory(), WebSocketMessageType.Text, true, timeout.Token);
NodeClient.Work? nextWork;
while (!client.TryTake(out nextWork)) await Task.Delay(5, timeout.Token);
Check(!client.IsCurrent(work!), "Old connection work must be rejected after reconnect");
Check(client.UserName(10000) == "10000", "Reconnect clears old user mappings");
client.Reply(work!, new { type = "delivery_result", request_id = "old-stale-reply", ok = true });
client.Reply(nextWork!, new { type = "api_result", request_id = "next", ok = true, players = Array.Empty<PlayerIdentity>() });
var nextResponse = await next.ReceiveAsync(nextBuffer.AsMemory(), timeout.Token);
Check(JsonDocument.Parse(nextBuffer.AsMemory(0, nextResponse.Count)).RootElement.GetProperty("request_id").GetString() == "next", "No stale reply leaks into new session");
Console.WriteLine("PASS C# WebSocket auth, v2, API, delivery ACK, Unicode chat, system events, reconnect isolation");
