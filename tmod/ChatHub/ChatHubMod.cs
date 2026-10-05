using System;
using Terraria;
using Terraria.Chat;
using Terraria.Chat.Commands;
using Terraria.DataStructures;
using Terraria.ID;
using Terraria.ModLoader;

namespace ChatHub;

public sealed class ChatHubMod : Mod
{
    [ThreadStatic] private static int? hitSender;
    [ThreadStatic] private static bool applyingDot;
    public override void Load()
    {
        if (!Main.dedServ) return;
        On_MessageBuffer.GetData += ReadPacket;
        On_NPC.StrikeNPC_HitInfo_bool_bool += Strike;
        On_NPC.UpdateNPC_BuffApplyDOTs += DamageOverTime;
        On_Player.KillMe += Death;
        On_SayChatCommand.ProcessIncomingMessage += Chat;
    }
    public override void Unload()
    {
        if (!Main.dedServ) return;
        On_MessageBuffer.GetData -= ReadPacket;
        On_NPC.StrikeNPC_HitInfo_bool_bool -= Strike;
        On_NPC.UpdateNPC_BuffApplyDOTs -= DamageOverTime;
        On_Player.KillMe -= Death;
        On_SayChatCommand.ProcessIncomingMessage -= Chat;
    }
    private static void ReadPacket(On_MessageBuffer.orig_GetData orig, MessageBuffer self, int start, int length, out int messageType)
    {
        var previous = hitSender;
        // Only damage packets can supply a player attribution. Never infer
        // ownership from NPC.target or playerInteraction (both lose accuracy).
        hitSender = length > 0 && self.readBuffer[start] == MessageID.DamageNPC ? self.whoAmI : null;
        try { orig(self, start, length, out messageType); }
        finally { hitSender = previous; }
    }
    private static int Strike(On_NPC.orig_StrikeNPC_HitInfo_bool_bool orig, NPC self, NPC.HitInfo hit, bool fromNet, bool noPlayerInteraction)
    {
        var system = ModContent.GetInstance<BridgeSystem>();
        var entity = system.Describe(self);
        var health = self.realLife >= 0 && self.realLife < Main.maxNPCs ? Main.npc[self.realLife].life : self.life;
        var damage = orig(self, hit, fromNet, noPlayerInteraction);
        if (entity != null && damage > 0 && !self.immortal && !applyingDot)
        {
            var player = !noPlayerInteraction && fromNet && hitSender is int sender ? system.Identity(sender) : null;
            system.RecordHit(entity, player, Math.Min(damage, Math.Max(0, health)));
        }
        return damage;
    }
    private static void DamageOverTime(On_NPC.orig_UpdateNPC_BuffApplyDOTs orig, NPC self)
    {
        var system = ModContent.GetInstance<BridgeSystem>();
        var entity = system.Describe(self);
        var healthOwner = self.realLife >= 0 && self.realLife < Main.maxNPCs ? Main.npc[self.realLife] : self;
        var health = healthOwner.life;
        var previous = applyingDot;
        applyingDot = true;
        try { orig(self); }
        finally { applyingDot = previous; }
        // Vanilla debuffs carry no authoritative applier identity. Report their
        // actual health loss as unknown, never assign it to the last hitter.
        if (entity != null) system.RecordHit(entity, null, (int)Math.Min(Math.Max(0, health), Math.Max(0L, (long)health - healthOwner.life)));
    }
    private static void Death(On_Player.orig_KillMe orig, Player self, PlayerDeathReason reason, double damage, int direction, bool pvp)
    {
        var wasDead = self.dead;
        // Capture the reason before hardcore death clears the player state.
        var text = reason.GetDeathText(self.name).ToString();
        orig(self, reason, damage, direction, pvp);
        if (!wasDead) ModContent.GetInstance<BridgeSystem>().PlayerDied(text);
    }
    private static void Chat(On_SayChatCommand.orig_ProcessIncomingMessage orig, SayChatCommand self, string text, byte clientId)
    {
        orig(self, text, clientId);
        // CommandLoader consumes handled mod commands before reaching Say.
        if (!text.StartsWith('/')) ModContent.GetInstance<BridgeSystem>().PlayerChat(clientId, text);
    }
}
