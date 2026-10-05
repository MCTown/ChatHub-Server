from copy import deepcopy


DEFAULT_CONFIG = {
    "server_url": "ws://127.0.0.1:6700/chathub/v2/connect",
    "password": "change-node-password",
    "node_id": "survival",
    "name": "生存服",
    # cache: authoritative UUID from login logs / usercache.json.
    # offline: Java's OfflinePlayer:<name> UUID; use a realm-specific scope.
    "identity_mode": "cache",
    "identity_scope": "minecraft:online",
    "game_directory": "",  # empty = MCDR working_directory
    "reconnect_seconds": 5,
    "color": "gray",
    # Match v1: emit CICode for clients with ChatImage installed.
    # False keeps the clickable image-link fallback.
    "chat_image": True,
    "system_messages": {
        "enabled": True,
        "startup_text": "服务器已启动",
        "shutdown_text": "服务器已关闭",
        "dedup_seconds": 2,
        "advancement_patterns": [
            r"^[A-Za-z0-9_]{1,16} has (?:made the advancement|reached the goal|completed the challenge) \[.+\]$",
        ],
        "death_patterns": [
            r"^[A-Za-z0-9_]{1,16} (?:was (?:shot|slain|killed|pummeled|fireballed|impaled|squished|obliterated|blown up|struck by lightning|roasted in dragon breath|poked to death|stung to death|squashed by|skewered by)|fell |died\b|drowned\b|burned to death|went up in flames|tried to swim in lava|hit the ground too hard|blew up|suffocated in a wall|starved to death|withered away|froze to death|walked into a cactus|was pricked to death|experienced kinetic energy|discovered the floor was lava|didn't want to live in the same world as|left the confines of this world|went off with a bang|walked into danger zone).*$",
        ],
    },
}


def default_config():
    return deepcopy(DEFAULT_CONFIG)
