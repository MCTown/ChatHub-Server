using Terraria;
using Terraria.DataStructures;
using Terraria.ModLoader;

namespace ChatHub;

public sealed class BossGlobalNPC : GlobalNPC
{
    public override bool InstancePerEntity => true;
    public long SpawnId { get; private set; }
    private static long nextSpawn;
    public override void OnSpawn(NPC npc, IEntitySource source) => SpawnId = ++nextSpawn;
    public override void OnKill(NPC npc)
    {
        if (Main.dedServ) ModContent.GetInstance<BridgeSystem>().BossKilled(npc);
    }
}
