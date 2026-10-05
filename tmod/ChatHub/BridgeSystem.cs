using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Xna.Framework;
using Terraria;
using Terraria.Chat;
using Terraria.ID;
using Terraria.Localization;
using Terraria.ModLoader;

namespace ChatHub;

public sealed class BridgeSystem : ModSystem
{
    private NodeSettings? settings;
    private NodeClient? client;
    private BossTracker? bosses;
    private readonly Dictionary<int, PlayerIdentity> roster = new();
    private long tick;
    private bool clientStarted;
    public override void OnModLoad()
    {
        if (Main.dedServ) Main.OnTickForThirdPartySoftwareOnly += ServerTick;
    }
    public override void OnWorldLoad()
    {
        if (!Main.dedServ) return;
        Close();
        roster.Clear();
        tick = 0;
        try
        {
            settings = NodeSettings.Load(Path.Combine(Main.SavePath, "ModConfigs", "ChatHub.json"));
            if (!settings.Enabled) { Mod.Logger.Info("ChatHub disabled; edit ModConfigs/ChatHub.json and restart server"); return; }
            bosses = new BossTracker(BossReport, settings.BossProgressSeconds);
            client = new NodeClient(settings, message => Mod.Logger.Info(message));
        }
        catch (Exception error) { Mod.Logger.Error("ChatHub configuration error: " + error.Message); }
    }
    public override void OnWorldUnload() => Close();
    public override void OnModUnload()
    {
        if (Main.dedServ) Main.OnTickForThirdPartySoftwareOnly -= ServerTick;
        Close();
    }
    private void Close()
    {
        client?.Dispose();
        client = null;
        bosses?.Clear();
        bosses = null;
        roster.Clear();
        settings = null;
        clientStarted = false;
    }
    private void ServerTick()
    {
        // Dedicated servers skip world updates while Netplay.HasClients=false.
        // This callback runs on the same server thread even for an empty server,
        // and begins only after world loading and network startup have finished.
        if (client == null) return;
        if (!clientStarted) { clientStarted = true; client.Start(); }
        tick++;
        var current = CurrentRoster();
        foreach (var entry in roster)
            if (!current.TryGetValue(entry.Key, out var player) || player.uuid != entry.Value.uuid)
                if (settings!.ForwardJoinLeave) client.System("leave", entry.Value.name + " 离开了服务器");
        foreach (var entry in current)
            if (!roster.TryGetValue(entry.Key, out var player) || player.uuid != entry.Value.uuid)
                if (settings!.ForwardJoinLeave) client.System("join", entry.Value.name + " 加入了服务器");
        roster.Clear();
        foreach (var entry in current) roster.Add(entry.Key, entry.Value);
        // All Terraria reads and broadcasts stay on the game thread.
        for (var count = 0; count < 20 && client.TryTake(out var work); count++)
        {
            if (work == null || !client.IsCurrent(work)) continue;
            var frame = work.Frame;
            var id = frame.GetProperty("request_id").GetString();
            var isApi = frame.GetProperty("type").GetString() == "api_call";
            try
            {
                if (isApi)
                {
                    if (frame.GetProperty("action").GetString() != "get_online_players") throw new InvalidOperationException("Unsupported API action");
                    var players = current.Values.ToArray();
                    if (players.Select(player => player.uuid).Distinct().Count() != players.Length) throw new InvalidOperationException("Duplicate character identities");
                    client.Reply(work, new { type = "api_result", request_id = id, ok = true, players });
                }
                else
                {
                    Broadcast(DeliveryRenderer.Render(frame, client.UserName));
                    client.Reply(work, new { type = "delivery_result", request_id = id, ok = true });
                }
            }
            catch (Exception error)
            {
                client.Reply(work, new { type = isApi ? "api_result" : "delivery_result", request_id = id, ok = false, error = NodeClient.Limit(error.Message, 500) });
            }
        }
        if (settings!.ForwardBosses)
        {
            // A completely empty server freezes its NPCs. End the abandoned
            // encounter rather than reporting frozen NPCs as an ongoing fight.
            var active = roster.Count == 0 ? Array.Empty<BossTracker.BossEntity>()
                : Main.npc.Where(npc => npc.active).Select(Describe).OfType<BossTracker.BossEntity>().ToArray();
            bosses!.Update(active, tick, roster.Values);
        }
    }
    private static Dictionary<int, PlayerIdentity> CurrentRoster()
    {
        var players = new Dictionary<int, PlayerIdentity>();
        for (var i = 0; i < Main.maxPlayers; i++)
            if (Main.player[i].active && Netplay.Clients[i].State == 10 && !string.IsNullOrWhiteSpace(Main.player[i].name))
                players.Add(i, PlayerIdentity.FromName(Main.player[i].name));
        return players;
    }
    public PlayerIdentity? Identity(int index) => index >= 0 && index < Main.maxPlayers && Main.player[index].active
        ? PlayerIdentity.FromName(Main.player[index].name) : null;
    public void PlayerChat(int index, string text)
    {
        if (settings?.ForwardChat == true && Identity(index) is { } player) client?.Chat(player, text);
    }
    public void PlayerDied(string text)
    {
        if (settings?.ForwardDeaths == true) client?.System("death", text);
    }
    public void RecordHit(BossTracker.BossEntity entity, PlayerIdentity? player, int damage)
    {
        if (settings?.ForwardBosses == true) bosses?.Hit(entity, player, damage, tick, roster.Values);
    }
    public void BossKilled(NPC npc)
    {
        if (settings?.ForwardBosses != true || Describe(npc) is not { } entity) return;
        bosses?.Killed(entity, tick, roster.Values);
        // EoW splits transform body slots into new heads without OnKill on the
        // previous form. The last surviving segment is the definitive victory.
        if (entity.Group == "vanilla:eow" && !Main.npc.Any(other => other.whoAmI != npc.whoAmI && other.active &&
            other.type is NPCID.EaterofWorldsHead or NPCID.EaterofWorldsBody or NPCID.EaterofWorldsTail))
            bosses?.ConfirmDefeat(entity.Group);
    }
    private void BossReport(string kind, string text)
    {
        client?.System(kind, text);
        if (settings?.BroadcastBossReports == true && kind != "boss_start") Broadcast(DeliveryRenderer.Plain(text));
    }
    private static void Broadcast(string text)
    {
        // Small packets also avoid the Terraria chat protocol's string size limit.
        foreach (var line in text.Replace("\r", "").Split('\n'))
        {
            if (line.Length == 0) continue;
            for (var start = 0; start < line.Length;)
            {
                var count = Math.Min(400, line.Length - start);
                if (start + count < line.Length && char.IsHighSurrogate(line[start + count - 1]) && char.IsLowSurrogate(line[start + count])) count--;
                ChatHelper.BroadcastChatMessage(NetworkText.FromLiteral(line.Substring(start, count)), Color.LightGray);
                start += count;
            }
        }
    }
    private static string Token(NPC npc) => npc.whoAmI + ":" + npc.GetGlobalNPC<BossGlobalNPC>().SpawnId;
    public BossTracker.BossEntity? Describe(NPC npc)
    {
        if (settings?.ForwardBosses != true) return null;
        var root = npc;
        if (npc.realLife >= 0 && npc.realLife < Main.maxNPCs) root = Main.npc[npc.realLife];
        var type = npc.type;
        if (type is NPCID.EaterofWorldsHead or NPCID.EaterofWorldsBody or NPCID.EaterofWorldsTail)
            return new BossTracker.BossEntity(Token(npc), "vanilla:eow", Lang.GetNPCNameValue(NPCID.EaterofWorldsHead), type == NPCID.EaterofWorldsHead);
        if (type is NPCID.Retinazer or NPCID.Spazmatism)
            return new BossTracker.BossEntity(Token(npc), "vanilla:twins", Lang.GetNPCNameValue(NPCID.Retinazer) + " / " + Lang.GetNPCNameValue(NPCID.Spazmatism), true);
        var parentType = type switch
        {
            NPCID.SkeletronHand => NPCID.SkeletronHead,
            NPCID.PrimeCannon or NPCID.PrimeLaser or NPCID.PrimeSaw or NPCID.PrimeVice => NPCID.SkeletronPrime,
            NPCID.GolemHead or NPCID.GolemHeadFree or NPCID.GolemFistLeft or NPCID.GolemFistRight => NPCID.Golem,
            NPCID.MoonLordHand or NPCID.MoonLordHead => NPCID.MoonLordCore,
            _ => -1
        };
        if (parentType >= 0)
        {
            var parent = Main.npc.Where(other => other.active && other.type == parentType).OrderBy(other => Vector2.DistanceSquared(other.Center, npc.Center)).FirstOrDefault();
            if (parent == null) return null;
            root = parent;
        }
        if (!root.boss && root.type != NPCID.MoonLordCore) return null;
        return new BossTracker.BossEntity(Token(npc), "root:" + Token(root), root.TypeName, npc.whoAmI == root.whoAmI);
    }
}
