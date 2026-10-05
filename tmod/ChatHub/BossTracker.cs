using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace ChatHub;

// Pure battle accounting; no Terraria or network dependencies.
public sealed class BossTracker
{
    public sealed record BossEntity(string Token, string Group, string Name, bool Terminal);
    private sealed class Battle
    {
        public required string Name;
        public long Started;
        public long LastActive;
        public long LastProgress;
        public readonly Dictionary<string, bool> Terminals = new();
        public readonly Dictionary<string, (PlayerIdentity Player, long Damage)> Players = new();
        public long Unknown;
    }
    private readonly Dictionary<string, Battle> battles = new();
    private readonly Action<string, string> emit;
    private readonly int progressTicks;
    public BossTracker(Action<string, string> emit, int progressSeconds = 0)
    { this.emit = emit; progressTicks = progressSeconds > 0 ? (int)Math.Min((long)progressSeconds * 60, int.MaxValue) : 0; }
    public void Clear() => battles.Clear();
    private Battle Observe(BossEntity entity, long tick, IEnumerable<PlayerIdentity> roster)
    {
        if (!battles.TryGetValue(entity.Group, out var battle))
        {
            battle = new Battle { Name = entity.Name, Started = tick, LastActive = tick, LastProgress = tick };
            battles.Add(entity.Group, battle);
            emit("boss_start", $"Boss 战开始：{entity.Name}");
        }
        battle.LastActive = tick;
        if (entity.Terminal) battle.Terminals.TryAdd(entity.Token, false);
        foreach (var player in roster) battle.Players.TryAdd(player.uuid, (player, 0));
        return battle;
    }
    public void Hit(BossEntity entity, PlayerIdentity? player, int damage, long tick, IEnumerable<PlayerIdentity> roster)
    {
        if (damage <= 0) return;
        var battle = Observe(entity, tick, roster);
        if (player == null) { battle.Unknown += damage; return; }
        battle.Players.TryGetValue(player.uuid, out var previous);
        battle.Players[player.uuid] = (player, previous.Damage + damage);
    }
    public void Killed(BossEntity entity, long tick, IEnumerable<PlayerIdentity> roster)
    {
        var battle = Observe(entity, tick, roster);
        if (entity.Terminal) battle.Terminals[entity.Token] = true;
    }
    public void ConfirmDefeat(string group)
    {
        if (!battles.TryGetValue(group, out var battle)) return;
        foreach (var token in battle.Terminals.Keys.ToArray()) battle.Terminals[token] = true;
        battle.Terminals["confirmed"] = true;
    }
    public void Update(IEnumerable<BossEntity> active, long tick, IEnumerable<PlayerIdentity> roster)
    {
        foreach (var entity in active) Observe(entity, tick, roster);
        foreach (var pair in battles.ToArray())
        {
            var battle = pair.Value;
            // Wait for multipart NPC updates and phase transitions, not the first part's death.
            if (tick - battle.LastActive >= 120)
            {
                var defeated = battle.Terminals.Count > 0 && battle.Terminals.Values.All(killed => killed);
                emit(defeated ? "boss_defeat" : "boss_escape", Report(battle, battle.LastActive, defeated ? "已击败" : "战斗结束（逃脱 / 团灭）"));
                battles.Remove(pair.Key);
            }
            else if (progressTicks > 0 && tick - battle.LastProgress >= progressTicks)
            {
                battle.LastProgress = tick;
                emit("boss_progress", Report(battle, tick, "战斗中"));
            }
        }
    }
    private static string Report(Battle battle, long tick, string status)
    {
        var total = battle.Unknown + battle.Players.Values.Sum(entry => entry.Damage);
        var text = new StringBuilder($"Boss：{battle.Name} · {status} · {(tick - battle.Started) / 60.0:F1}s\n伤害合计：{total}");
        foreach (var entry in battle.Players.Values.OrderByDescending(entry => entry.Damage).ThenBy(entry => entry.Player.name, StringComparer.Ordinal))
        {
            var share = total == 0 ? 0 : entry.Damage * 100.0 / total;
            text.Append('\n').Append(entry.Player.name).Append(": ").Append(entry.Damage).Append("（").Append(share.ToString("F2", CultureInfo.InvariantCulture)).Append("%）");
        }
        if (battle.Unknown > 0) text.Append("\n未归属伤害: ").Append(battle.Unknown).Append("（").Append((battle.Unknown * 100.0 / total).ToString("F2", CultureInfo.InvariantCulture)).Append("%）");
        return text.ToString();
    }
}
