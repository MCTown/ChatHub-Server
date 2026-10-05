using System;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ChatHub;

// Deliberately NOT a ServerSide ModConfig: secrets must never be synced to players.
public sealed class NodeSettings
{
    public bool Enabled { get; set; } = false;
    public string ServerUrl { get; set; } = "ws://127.0.0.1:6700/chathub/v2/connect";
    public string Password { get; set; } = "";
    public string NodeId { get; set; } = "terraria";
    public string Name { get; set; } = "泰拉瑞亚";
    public string IdentityScope { get; set; } = "terraria:characters:my-server";
    public int ReconnectSeconds { get; set; } = 5;
    public bool ForwardChat { get; set; } = true;
    public bool ForwardJoinLeave { get; set; } = true;
    public bool ForwardDeaths { get; set; } = true;
    public bool ForwardBosses { get; set; } = true;
    public int BossProgressSeconds { get; set; } = 0;
    public bool BroadcastBossReports { get; set; } = true;

    public static NodeSettings Load(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        if (!File.Exists(path)) File.WriteAllText(path, JsonSerializer.Serialize(new NodeSettings(), new JsonSerializerOptions { WriteIndented = true }));
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        var settings = JsonSerializer.Deserialize<NodeSettings>(File.ReadAllText(path)) ?? throw new InvalidDataException("Empty ChatHub config");
        settings.Password = Environment.GetEnvironmentVariable("CHATHUB_NODE_PASSWORD") ?? settings.Password;
        if (!settings.Enabled) return settings;
        if (!Uri.TryCreate(settings.ServerUrl, UriKind.Absolute, out var url) || (url.Scheme != "ws" && url.Scheme != "wss") || url.UserInfo.Length > 0)
            throw new InvalidDataException("ServerUrl must be a ws/wss URL without user credentials");
        if (string.IsNullOrWhiteSpace(settings.Password) || settings.Password.Contains('\r') || settings.Password.Contains('\n'))
            throw new InvalidDataException("Password is required");
        if (!Regex.IsMatch(settings.NodeId, @"\A[A-Za-z0-9_.-]{1,64}\z") || string.IsNullOrWhiteSpace(settings.Name) || settings.Name.Length > 80)
            throw new InvalidDataException("Invalid NodeId or Name");
        if (string.IsNullOrWhiteSpace(settings.IdentityScope) || settings.IdentityScope.Length > 100 || !settings.IdentityScope.StartsWith("terraria:"))
            throw new InvalidDataException("Use a separate terraria: identity scope");
        if (settings.ReconnectSeconds < 1 || settings.BossProgressSeconds < 0)
            throw new InvalidDataException("Invalid reconnect/progress interval");
        return settings;
    }
}
