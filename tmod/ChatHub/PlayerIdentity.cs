using System;
using System.Security.Cryptography;
using System.Text;

namespace ChatHub;

public sealed record PlayerIdentity(string uuid, string name)
{
    // Terraria has no authenticated account UUID. Use exact character names in a
    // realm-specific scope, never claim these are Steam/Minecraft identities.
    public static PlayerIdentity FromName(string name)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes("ChatHub:Terraria:Character:" + name));
        return new PlayerIdentity(Convert.ToHexString(hash.AsSpan(0, 16)).ToLowerInvariant(), name);
    }
}
