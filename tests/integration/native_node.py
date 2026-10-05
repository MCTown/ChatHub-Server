"""Live websocket-client + real plugin hooks, with a simulated MCDR console.
No Minecraft game process is launched by this test.
"""
import json
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "plugin"))
import chathub
from chathub.config import default_config

lock = threading.Lock()


def emit(value):
    with lock:
        print(json.dumps(value), flush=True)


class Logger:
    def info(self, message):
        if "Registered as group" in message:
            emit({"type": "ready", "message": message})

    def warning(self, message):
        emit({"type": "warning", "message": message})


class Server:
    logger = Logger()
    running = True

    def load_config_simple(self, file, defaults):
        return {**default_config(), "server_url": sys.argv[1], "password": "nodes",
                "node_id": "live-python", "name": "Python node"}

    def get_mcdr_config(self):
        return {"working_directory": "."}

    def is_server_running(self):
        return self.running

    def execute(self, command):
        emit({"type": "game_command", "command": command})
        if command == "list":
            chathub.on_info(self, SimpleNamespace(is_from_server=True, player=None,
                content="UUID of player Steve is 8667ba71-b85a-4004-af54-457a9734eed7"))
            chathub.on_info(self, SimpleNamespace(is_from_server=True, player=None,
                content="There are 1 of a max of 20 players online: Steve"))

    def register_event_listener(self, event, handler):
        pass


server = Server()
chathub.on_load(server, None)
chathub.on_info(server, SimpleNamespace(is_from_server=True,
    content="UUID of player Steve is 8667ba71-b85a-4004-af54-457a9734eed7"))
try:
    for raw in sys.stdin:
        event = json.loads(raw)
        if event["type"] == "chat":
            chathub.on_user_info(server, SimpleNamespace(player="Steve", content=event["text"]))
        elif event["type"] == "join":
            chathub.on_player_joined(server, "Steve", None)
        elif event["type"] == "leave":
            chathub.on_player_left(server, "Steve")
        elif event["type"] == "log":
            chathub.on_info(server, SimpleNamespace(is_from_server=True, player=None, content=event["text"]))
        elif event["type"] == "startup":
            chathub.on_server_startup(server)
        elif event["type"] == "shutdown":
            server.running = False
            chathub.on_server_stop(server, 0)
        elif event["type"] == "stop":
            break
finally:
    chathub.on_unload(server)
