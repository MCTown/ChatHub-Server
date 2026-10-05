import hashlib
import json
import re
import uuid
from pathlib import Path


PLAYER_NAME = re.compile(r"^[A-Za-z0-9_]{1,16}$")


class PlayerDirectory:
    """No Mojang lookup or nickname-derived identity in online/cache mode."""

    def __init__(self, directory, mode="cache"):
        if mode not in ("cache", "offline"):
            raise ValueError("identity_mode must be cache or offline")
        self.directory = Path(directory)
        self.mode = mode
        self._observed = {}

    def observe(self, name, value):
        if PLAYER_NAME.fullmatch(name):
            self._observed[name] = str(uuid.UUID(value))

    def resolve(self, name):
        if not PLAYER_NAME.fullmatch(name):
            raise ValueError("Invalid Minecraft player name")
        if self.mode == "offline":
            digest = hashlib.md5(("OfflinePlayer:" + name).encode("utf-8"), usedforsecurity=False).digest()
            return {"uuid": str(uuid.UUID(bytes=digest, version=3)), "name": name}
        if name in self._observed:
            return {"uuid": self._observed[name], "name": name}
        file = self.directory / "usercache.json"
        if file.exists():
            for entry in json.loads(file.read_text(encoding="utf-8")):
                if entry.get("name", "").lower() == name.lower():
                    return {"uuid": str(uuid.UUID(entry["uuid"])), "name": name}
        raise ValueError(f"Authoritative UUID unavailable for {name}; check login logs / usercache.json")
