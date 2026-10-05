import json
import queue
import threading
import uuid

import websocket

from chathub.render import tellraw_command


class NodeClient:
    """A native ChatHub node, not a OneBot implementation.

    MCDR hooks enqueue short messages. All network IO runs in a daemon thread.
    Offline chat is not replayed. Online lists are queried by the server.
    """

    def __init__(self, server, config, get_online_players):
        self.server = server
        self.config = config
        self.get_online_players = get_online_players
        self._stop = threading.Event()
        self._closing = threading.Event()
        self._registered = threading.Event()
        self._outbox = queue.Queue(maxsize=1000)
        self._api_queue = queue.Queue(maxsize=1)
        self._queue_lock = threading.Lock()
        self._drained = threading.Event()
        self._drained.set()
        self._ws = None
        self._users = {}
        self._threads = []

    def start(self):
        for name, target in (("ChatHubConnection", self._connect), ("ChatHubSender", self._send_loop),
                             ("ChatHubAPI", self._api_loop)):
            thread = threading.Thread(name=name, target=target, daemon=True)
            self._threads.append(thread)
            thread.start()

    def close(self):
        self._closing.set()
        # Give the normal on_server_stop announcement a short opportunity to
        # leave the current connection before on_unload closes its socket.
        if self._registered.is_set():
            self._drained.wait(timeout=1)
        self._stop.set()
        self._registered.clear()
        if self._ws:
            self._ws.close()
        for thread in self._threads:
            if thread is not threading.current_thread():
                thread.join(timeout=3)

    def emit(self, event):
        with self._queue_lock:
            if self._closing.is_set() or not self._registered.is_set():
                return False
            try:
                self._outbox.put_nowait((self._ws, event))
                self._drained.clear()
                return True
            except queue.Full:
                self.server.logger.warning("[ChatHub] Outbox full; event dropped")
                return False

    def chat(self, player, text):
        return self.emit({"type": "chat", "event_id": uuid.uuid4().hex,
                          "player": player, "segments": [{"type": "text", "text": text}]})

    def system(self, kind, text):
        return self.emit({"type": "system", "event_id": uuid.uuid4().hex, "kind": kind, "text": text})

    def _connect(self):
        while not self._stop.is_set():
            self._registered.clear()
            app = websocket.WebSocketApp(
                self.config["server_url"],
                header={"Authorization": "Bearer " + self.config["password"]},
                on_open=self._on_open, on_message=self._on_message,
                on_error=lambda _ws, error: self.server.logger.warning(f"[ChatHub] Connection error: {error}"),
                on_close=lambda _ws, _code, _reason: self._registered.clear(),
            )
            self._ws = app
            try:
                if not self._stop.is_set():
                    app.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as error:
                self.server.logger.warning(f"[ChatHub] Connection failed: {error}")
            self._registered.clear()
            self._stop.wait(self.config["reconnect_seconds"])

    def _send_loop(self):
        while not self._stop.is_set():
            try:
                session, event = self._outbox.get(timeout=0.2)
            except queue.Empty:
                continue
            # Do not deliver a previous connection's queued events on reconnect.
            try:
                if session is self._ws and self._registered.is_set():
                    session.send(json.dumps(event, ensure_ascii=False))
            except Exception as error:
                self.server.logger.warning(f"[ChatHub] Event dropped after send failure: {error}")
                self._registered.clear()
                session.close()
            finally:
                self._outbox.task_done()
                with self._queue_lock:
                    if self._outbox.empty():
                        self._drained.set()

    def _on_open(self, ws):
        if self._stop.is_set() or self._closing.is_set():
            ws.close()
            return
        ws.send(json.dumps({"type": "hello", "version": 2,
                            "node_id": self.config["node_id"], "name": self.config["name"],
                            "identity_scope": self.config["identity_scope"]}, ensure_ascii=False))

    def _on_message(self, ws, raw):
        if self._stop.is_set():
            return
        try:
            event = json.loads(raw)
            kind = event.get("type")
            if kind == "registered":
                self._users = {}
                system_user = event.get("system_user")
                if system_user:
                    self._users[str(system_user["user_id"])] = system_user["name"]
                self._registered.set()
                self.server.logger.info(f"[ChatHub] Registered as group {event['group_id']}")
            elif kind == "users":
                self._users.update({str(user["user_id"]): user["name"] for user in event["users"]})
            elif kind == "api_call":
                try:
                    self._api_queue.put_nowait((ws, event))
                except queue.Full:
                    ws.send(json.dumps({"type": "api_result", "request_id": event["request_id"],
                                        "ok": False, "error": "Client API queue full"}))
            elif kind == "accepted":
                self._users[str(event["user_id"])] = event["name"]
            elif kind == "deliver":
                self._deliver(ws, event)
            elif kind == "error":
                self.server.logger.warning(f"[ChatHub] Protocol error: {event.get('message')}")
        except Exception as error:
            self.server.logger.warning(f"[ChatHub] Invalid frame: {error}")

    def _api_loop(self):
        # `list` waits for an MCDR log callback, never block WebSocket delivery/ping handling.
        while not self._stop.is_set():
            try:
                ws, event = self._api_queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                if ws is self._ws and self._registered.is_set():
                    self._call_api(ws, event)
            except Exception as error:
                self.server.logger.warning(f"[ChatHub] API response failed: {error}")
            finally:
                self._api_queue.task_done()

    def _call_api(self, ws, event):
        result = {"type": "api_result", "request_id": event["request_id"]}
        try:
            if event.get("action") != "get_online_players":
                raise ValueError("Unsupported client API action")
            result.update(ok=True, players=self.get_online_players())
        except Exception as error:
            result.update(ok=False, error=str(error)[:500])
        # Bind results to the requesting connection, never to a replacement session.
        if ws is self._ws and self._registered.is_set() and not self._stop.is_set():
            ws.send(json.dumps(result, ensure_ascii=False))

    def _deliver(self, ws, event):
        try:
            if not self.server.is_server_running():
                raise RuntimeError("Minecraft server is not running")
            command = tellraw_command(event, self._users, self.config["color"], self.config["chat_image"])
            self.server.execute(command)
            result = {"type": "delivery_result", "request_id": event["request_id"], "ok": True}
        except Exception as error:
            result = {"type": "delivery_result", "request_id": event["request_id"],
                      "ok": False, "error": str(error)[:500]}
        # ACK means accepted into MCDR's command pipe, not that a human read it.
        ws.send(json.dumps(result))
