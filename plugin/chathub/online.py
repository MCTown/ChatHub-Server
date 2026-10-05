"""Answer server-initiated roster queries using a fresh Minecraft `list` result."""
import re
import threading


class OnlinePlayers:
    _list_log = re.compile(r"^There are (\d+) of a max of \d+ players online:\s*(.*)$")

    def __init__(self, server, directory, timeout=3):
        self.server = server
        self.directory = directory
        self.timeout = timeout
        self._lock = threading.RLock()
        self._pending = None

    def query(self):
        if not self.server.is_server_running():
            return []
        pending = {"ready": threading.Event()}
        with self._lock:
            if self._pending is not None:
                raise RuntimeError("Online player query already in progress")
            self._pending = pending
        try:
            self.server.execute("list")
            if not pending["ready"].wait(self.timeout):
                raise RuntimeError("Minecraft list response timed out; check list output format")
            if "error" in pending:
                raise RuntimeError(pending["error"])
            return pending["players"]
        finally:
            with self._lock:
                if self._pending is pending:
                    self._pending = None

    def log(self, info):
        if not getattr(info, "is_from_server", False) or getattr(info, "player", None):
            return
        match = self._list_log.fullmatch(info.content)
        if not match:
            return
        with self._lock:
            pending = self._pending
            if pending is None or pending["ready"].is_set():
                return
            try:
                names = [name.strip() for name in match[2].split(",") if name.strip()]
                if len(names) != int(match[1]) or len(set(names)) != len(names):
                    raise ValueError("Incomplete Minecraft online player list")
                # A partial list must not be mistaken for evidence that other players left.
                pending["players"] = [self.directory.resolve(name) for name in names]
            except Exception as error:
                pending["error"] = str(error)
            pending["ready"].set()

    def stopped(self):
        with self._lock:
            if self._pending is not None:
                self._pending["players"] = []
                self._pending.pop("error", None)
                self._pending["ready"].set()
