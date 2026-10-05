"""MCDR event hooks. Native networking is isolated in client.py."""
import re
from pathlib import Path
from urllib.parse import urlsplit

from chathub.config import default_config
from chathub.identity import PlayerDirectory
from chathub.online import OnlinePlayers
from chathub.system_messages import SystemMessages

_client = None
_directory = None
_server = None
_system_messages = None
_online_players = None
_uuid_log = re.compile(r"UUID of player ([A-Za-z0-9_]{1,16}) is ([0-9a-fA-F-]{32,36})")


def _player(name):
    if _directory is None:
        return None
    try:
        return _directory.resolve(name)
    except Exception as error:
        _server.logger.warning(f"[ChatHub] Player identity unavailable: {error}")
        return None


def on_load(server, old_plugin):
    global _client, _directory, _server, _system_messages, _online_players
    from chathub.client import NodeClient

    if _client:
        _client.close()
    _server = server
    config = {**default_config(), **server.load_config_simple("chathub.json", default_config())}
    url = urlsplit(config["server_url"])
    if url.scheme not in ("ws", "wss") or not url.netloc:
        raise ValueError("server_url must be a ws:// or wss:// URL")
    if not config["password"] or "\n" in config["password"] or "\r" in config["password"]:
        raise ValueError("A valid node password is required")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", config["node_id"]):
        raise ValueError("Invalid node_id")
    if not config["identity_scope"] or not config["name"]:
        raise ValueError("identity_scope and name are required")
    if config["identity_mode"] == "offline" and config["identity_scope"] == "minecraft:online":
        raise ValueError("Offline mode needs a separate identity_scope, e.g. minecraft:offline:my-network")
    if not isinstance(config["reconnect_seconds"], (int, float)) or config["reconnect_seconds"] < 1:
        raise ValueError("reconnect_seconds must be >= 1")
    directory = config["game_directory"] or server.get_mcdr_config()["working_directory"]
    _directory = PlayerDirectory(Path(directory), config["identity_mode"])
    _online_players = OnlinePlayers(server, _directory)
    _client = NodeClient(server, config, _online_players.query)
    _system_messages = SystemMessages(_client, config["system_messages"])
    _client.start()
    # Optional event providers supplement the native vanilla log recognizer.
    server.register_event_listener("PlayerDeathEvent", on_player_death)
    server.register_event_listener("PlayerAdvancementEvent", on_player_advancement)
    server.logger.info("[ChatHub] Native node loaded; configure a unique node_id for each server")


def on_unload(server):
    global _client, _system_messages, _online_players
    if _online_players:
        _online_players.stopped()
    if _client:
        _client.close()
        _client = None
    _system_messages = None
    _online_players = None


def on_info(server, info):
    if _system_messages:
        _system_messages.log(info)
    if getattr(info, "is_from_server", False) and _directory:
        match = _uuid_log.search(info.content)
        if match:
            _directory.observe(match[1], match[2])
    if _online_players:
        _online_players.log(info)


def on_user_info(server, info):
    if not info.player or not _client:
        return
    player = _player(info.player)
    if player:
        _client.chat(player, info.content)


def on_player_joined(server, player, info):
    if _system_messages:
        _system_messages.player_joined(player)


def on_player_left(server, player):
    if _system_messages:
        _system_messages.player_left(player)


def on_server_startup(server):
    if _system_messages:
        _system_messages.startup()


def on_server_stop(server, server_return_code):
    if _online_players:
        _online_players.stopped()
    if _system_messages:
        _system_messages.shutdown()


def on_player_death(server, player, event, content):
    if _system_messages:
        _system_messages.emit("death", content)


def on_player_advancement(server, player, event, content):
    if _system_messages:
        _system_messages.emit("advancement", content)
