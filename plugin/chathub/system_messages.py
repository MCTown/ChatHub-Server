"""Minecraft-specific system-message recognition and formatting lives here.

The ChatHub server receives finished text; it never parses death/achievement
logs or assigns a Minecraft player's identity to those announcements.
"""
import re
import threading
import time
from collections import OrderedDict

from chathub.config import default_config


class SystemMessages:
    def __init__(self, client, settings=None, clock=time.monotonic):
        self.client = client
        self.settings = {**default_config()["system_messages"], **(settings or {})}
        if not isinstance(self.settings["enabled"], bool):
            raise ValueError("system_messages.enabled must be boolean")
        seconds = self.settings["dedup_seconds"]
        if not isinstance(seconds, (int, float)) or seconds < 0:
            raise ValueError("system_messages.dedup_seconds must be >= 0")
        for key in ("startup_text", "shutdown_text"):
            if not isinstance(self.settings[key], str) or not 0 < len(self.settings[key]) <= 16000:
                raise ValueError(f"system_messages.{key} must be non-empty text (max 16000)")
        self.patterns = {}
        for kind in ("death", "advancement"):
            expressions = self.settings[kind + "_patterns"]
            if not isinstance(expressions, list) or not all(isinstance(item, str) for item in expressions):
                raise ValueError(f"system_messages.{kind}_patterns must be an array of regex strings")
            self.patterns[kind] = [re.compile(item) for item in expressions]
        self._recent = OrderedDict()
        self._clock = clock
        self._lock = threading.Lock()

    def startup(self):
        return self.emit("startup", self.settings["startup_text"], "lifecycle")

    def shutdown(self):
        return self.emit("shutdown", self.settings["shutdown_text"], "lifecycle")

    def player_joined(self, player):
        return self.emit("join", f"{player} 加入了服务器", "lifecycle")

    def player_left(self, player):
        return self.emit("leave", f"{player} 离开了服务器", "lifecycle")

    def log(self, info):
        # Do not interpret player chat or console command responses as a
        # death/advancement merely because their text contains those words.
        if not getattr(info, "is_from_server", False) or getattr(info, "player", None):
            return False
        text = self.clean(info.content)
        for kind, patterns in self.patterns.items():
            if any(pattern.search(text) for pattern in patterns):
                return self.emit(kind, text, "log")
        return False

    def emit(self, kind, content, source="provider"):
        if not self.settings["enabled"]:
            return False
        text = self.clean(content)[:16000]
        if not text:
            return False
        key = (kind, text)
        now = self._clock()
        with self._lock:
            previous = self._recent.get(key)
            # Suppress the same announcement observed by both vanilla logs
            # and an optional event-provider plugin. Repeated real events from
            # the SAME source are not collapsed.
            if previous and previous[1] != source and now - previous[0] <= self.settings["dedup_seconds"]:
                return False
            sent = self.client.system(kind, text)
            if sent:
                self._recent[key] = (now, source)
                self._recent.move_to_end(key)
                while len(self._recent) > 256:
                    self._recent.popitem(last=False)
            return sent

    @staticmethod
    def clean(content):
        values = content if isinstance(content, (list, tuple)) else [content]
        text = "\n".join(str(getattr(value, "raw", value)) for value in values)
        return re.sub(r"§[0-9A-FK-ORa-fk-or]", "", text).strip()
