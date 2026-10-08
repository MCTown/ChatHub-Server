import importlib
import json
import sys
import tempfile
import types
import unittest
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chathub.identity import PlayerDirectory
from chathub.render import tellraw_command
from chathub.config import default_config
from chathub.system_messages import SystemMessages
from chathub.online import OnlinePlayers
from unittest.mock import patch
import chathub


class IdentityTests(unittest.TestCase):
    def test_offline_java_uuid_and_scope_independence(self):
        directory = PlayerDirectory(".", "offline")
        self.assertEqual(directory.resolve("Notch")["uuid"], "b50ad385-829d-3141-a216-7e7d7539ba7f")
        self.assertNotEqual(directory.resolve("Notch"), directory.resolve("notch"))

    def test_cache_is_authoritative_and_missing_uuid_not_fabricated(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = PlayerDirectory(temp)
            with self.assertRaises(ValueError):
                directory.resolve("Steve")
            (Path(temp) / "usercache.json").write_text(json.dumps([
                {"name": "Steve", "uuid": "8667ba71-b85a-4004-af54-457a9734eed7"}
            ]))
            self.assertEqual(directory.resolve("Steve")["uuid"], "8667ba71-b85a-4004-af54-457a9734eed7")
            directory.observe("Alex", "ec561538-f3fd-461d-aff5-086b22154bce")
            self.assertEqual(directory.resolve("Alex")["name"], "Alex")
            with self.assertRaises(ValueError):
                directory.resolve('Steve\nstop')

    def test_defaults_do_not_share_nested_mutable_state(self):
        a, b = default_config(), default_config()
        a["node_id"] = "other"
        self.assertEqual(b["node_id"], "survival")


class RendererTests(unittest.TestCase):
    def test_hidden_system_name_retains_source_without_empty_brackets(self):
        command = tellraw_command({"authorName": "", "sourceGroupName": "生存服",
                                   "segments": [{"type": "text", "text": "Steve died"}]}, {})
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual("".join(part["text"] for part in parts), "[生存服] Steve died")

    def test_untrusted_text_is_json_not_command(self):
        text = '"}]\nstop\n{"text":"'
        command = tellraw_command({"segments": [{"type": "text", "text": text}]}, {})
        self.assertTrue(command.startswith("tellraw @a "))
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual(parts[1]["text"], text)
        self.assertNotIn("\n", command)

    def test_mentions_images_and_prefixes(self):
        command = tellraw_command({"authorName": "Steve", "sourceGroupName": "创造服", "segments": [
            {"type": "mention", "userId": 10000}, {"type": "mention", "userId": "all"},
            {"type": "image", "url": "https://example.org/a.png"}
        ]}, {"10000": "Alex"})
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual(parts[1]["text"], "[创造服] ")
        self.assertEqual(parts[2]["text"], "<Steve> ")
        self.assertEqual(parts[3]["text"], "@Alex ")
        self.assertEqual(parts[-1]["clickEvent"]["action"], "open_url")

    def test_images_default_to_v1_cicode_and_preserve_qq_query_parameters(self):
        urls = [
            "https://multimedia.nt.qq.com.cn/download?appid=1407&fileid=abc&rkey=a-b_c%2F%3D",
            "https://example.org/animation.gif",
        ]
        command = tellraw_command({"sourceGroupName": "QQ 群", "authorName": "群名片", "segments": [
            {"type": "text", "text": "前文"},
            {"type": "image", "url": urls[0]},
            {"type": "text", "text": "中间"},
            {"type": "image", "url": urls[1]},
            {"type": "text", "text": "后文"},
        ]}, {})
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual("".join(part["text"] for part in parts),
                         f"[QQ 群] <群名片> 前文[[CICode,url={urls[0]},name=图片]]"
                         f"中间[[CICode,url={urls[1]},name=图片]]后文")
        for part, url in zip((parts[4], parts[6]), urls):
            self.assertEqual(part["text"], f"[[CICode,url={url},name=图片]]")
            self.assertEqual(part["clickEvent"], {"action": "open_url", "value": url})
        self.assertTrue(default_config()["chat_image"])

    def test_chat_image_can_be_disabled_for_link_only_display(self):
        url = "https://example.org/a.png"
        command = tellraw_command({"segments": [{"type": "image", "url": url}]}, {}, chat_image=False)
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual(parts[-1]["text"], "[图片]")
        self.assertEqual(parts[-1]["clickEvent"], {"action": "open_url", "value": url})

    def test_cicode_delimiters_cannot_inject_attributes_or_additional_images(self):
        url = "https://example.org/a,b[name].png?x=1,nsfw=true]]"
        command = tellraw_command({"segments": [{"type": "image", "url": url}]}, {})
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual(parts[-1]["text"],
                         "[[CICode,url=https://example.org/a%2Cb%5Bname%5D.png?x=1%2Cnsfw=true%5D%5D,name=图片]]")
        self.assertEqual(parts[-1]["clickEvent"]["value"], url)

    def test_non_http_images_are_rejected_in_both_modes(self):
        for url in ("file:///tmp/a.png", "base64://abcd", "javascript:alert(1)"):
            for enabled in (True, False):
                with self.subTest(url=url, chat_image=enabled):
                    with self.assertRaises(ValueError):
                        tellraw_command({"segments": [{"type": "image", "url": url}]}, {}, chat_image=enabled)

    def test_source_client_and_sender_display_format(self):
        for source, author, text in [
            ("生存服", "Steve", "你好"),
            ("玩家交流群", "群名片", "hello from QQ"),
            ("创造服", "Minecraft Server", "Steve fell from a high place"),
        ]:
            with self.subTest(source=source, author=author):
                command = tellraw_command({"sourceGroupName": source, "authorName": author,
                                           "segments": [{"type": "text", "text": text}]}, {})
                parts = json.loads(command[len("tellraw @a "):])
                self.assertEqual("".join(part["text"] for part in parts), f"[{source}] <{author}> {text}")

    def test_application_delivery_without_source_preserves_sender_only(self):
        command = tellraw_command({"authorName": "ChatHub", "segments": [{"type": "text", "text": "hello"}]}, {})
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual("".join(part["text"] for part in parts), "<ChatHub> hello")

    def test_untrusted_client_and_sender_names_are_json_not_commands(self):
        source, author = '世界"]\nstop', '玩家"}\nstop'
        command = tellraw_command({"sourceGroupName": source, "authorName": author,
                                   "segments": [{"type": "text", "text": "hello"}]}, {})
        parts = json.loads(command[len("tellraw @a "):])
        self.assertEqual("".join(part["text"] for part in parts), f"[{source}] <{author}> hello")
        self.assertNotIn("\n", command)


class ClientTests(unittest.TestCase):
    def setUp(self):
        # Standard-library unit tests require no external websocket/MCDR install.
        # Actual transport is separately tested against a live server.
        if "websocket" not in sys.modules:
            try:
                importlib.import_module("websocket")
            except ImportError:
                sys.modules["websocket"] = types.ModuleType("websocket")
        self.client_module = importlib.import_module("chathub.client")
        self.sent = []
        self.commands = []
        self.running = True
        self.server = types.SimpleNamespace(
            logger=types.SimpleNamespace(info=lambda *_: None, warning=lambda *_: None),
            is_server_running=lambda: self.running,
            execute=self.commands.append,
        )
        self.client = self.client_module.NodeClient(self.server, default_config(), lambda: [])
        self.socket = types.SimpleNamespace(send=lambda value: self.sent.append(json.loads(value)))

    def test_hello_uses_native_protocol_and_does_not_leak_password(self):
        self.client._on_open(self.socket)
        self.assertEqual(self.sent[0]["type"], "hello")
        self.assertEqual(self.sent[0]["version"], 2)
        self.assertNotIn("players", self.sent[0])
        self.assertNotIn("password", self.sent[0])
        self.assertNotIn("action", self.sent[0])

    def test_client_api_returns_roster_empty_list_and_explicit_failures(self):
        self.client._ws = self.socket
        self.client._registered.set()
        event = {"type": "api_call", "action": "get_online_players", "request_id": "q1"}
        players = [{"uuid": "0" * 32, "name": "Steve"}]
        self.client.get_online_players = lambda: players
        self.client._call_api(self.socket, event)
        self.assertEqual(self.sent[-1], {"type": "api_result", "request_id": "q1", "ok": True, "players": players})
        self.client.get_online_players = lambda: []
        self.client._call_api(self.socket, event)
        self.assertEqual(self.sent[-1]["players"], [])
        def fail():
            raise RuntimeError("list timed out")
        self.client.get_online_players = fail
        self.client._call_api(self.socket, event)
        self.assertFalse(self.sent[-1]["ok"])
        self.assertNotIn("players", self.sent[-1])
        self.client._call_api(self.socket, {**event, "action": "unknown"})
        self.assertIn("Unsupported", self.sent[-1]["error"])

    def test_api_response_does_not_leak_into_replacement_connection(self):
        self.client._ws = self.socket
        self.client._registered.set()
        def query():
            self.client._ws = object()
            return []
        self.client.get_online_players = query
        self.client._call_api(self.socket, {"action": "get_online_players", "request_id": "old"})
        self.assertEqual(self.sent, [])

    def test_api_wait_does_not_block_delivery_or_send_presence_after_registration(self):
        entered, release = threading.Event(), threading.Event()
        def query():
            entered.set()
            release.wait(1)
            return []
        self.client.get_online_players = query
        self.client._ws = self.socket
        self.client._on_message(self.socket, json.dumps({"type": "registered", "version": 2, "group_id": 10000}))
        self.assertTrue(self.client._outbox.empty())
        worker = threading.Thread(target=self.client._api_loop, daemon=True)
        worker.start()
        try:
            self.client._on_message(self.socket, json.dumps({"type": "api_call", "request_id": "q", "action": "get_online_players"}))
            self.assertTrue(entered.wait(1))
            self.client._on_message(self.socket, json.dumps({"type": "deliver", "request_id": "d", "segments": []}))
            self.assertEqual(self.sent[-1]["type"], "delivery_result")
        finally:
            release.set()
            self.client._stop.set()
            worker.join(1)

    def test_delivery_acknowledges_command_and_reports_offline(self):
        delivery = {"type": "deliver", "request_id": "r1", "messageId": 100,
                    "segments": [{"type": "text", "text": "hello"}]}
        self.client._deliver(self.socket, delivery)
        self.assertEqual(len(self.commands), 1)
        self.assertTrue(self.sent[0]["ok"])
        self.running = False
        self.client._deliver(self.socket, delivery)
        self.assertEqual(len(self.commands), 1)
        self.assertFalse(self.sent[-1]["ok"])

    def test_image_delivery_uses_default_cicode_and_respects_explicit_opt_out(self):
        url = "https://example.org/a.gif?fileid=abc&rkey=123"
        delivery = {"type": "deliver", "request_id": "image", "segments": [{"type": "image", "url": url}]}
        for enabled in (True, False):
            with self.subTest(chat_image=enabled):
                self.client.config["chat_image"] = enabled
                self.client._deliver(self.socket, delivery)
                parts = json.loads(self.commands[-1][len("tellraw @a "):])
                self.assertEqual(parts[-1]["text"], f"[[CICode,url={url},name=图片]]" if enabled else "[图片]")
                self.assertEqual(self.sent[-1], {"type": "delivery_result", "request_id": "image", "ok": True})

    def test_offline_chat_is_not_queued(self):
        self.assertFalse(self.client.chat({"uuid": "0" * 32, "name": "Steve"}, "offline"))
        self.assertTrue(self.client._outbox.empty())

    def test_system_message_has_unique_event_id_and_no_player_identity(self):
        self.client._ws = self.socket
        self.client._registered.set()
        self.assertTrue(self.client.system('startup', '服务器已启动'))
        self.assertTrue(self.client.system('shutdown', '服务器已关闭'))
        first = self.client._outbox.get()[1]
        second = self.client._outbox.get()[1]
        self.assertEqual(first['type'], 'system')
        self.assertEqual(first['kind'], 'startup')
        self.assertNotEqual(first['event_id'], second['event_id'])
        self.assertNotIn('player', first)

    def test_normal_close_drains_shutdown_message_before_closing_socket(self):
        closed = []
        self.socket.close = lambda: closed.append(True)
        self.client._ws = self.socket
        self.client._registered.set()
        thread = threading.Thread(target=self.client._send_loop, daemon=True)
        self.client._threads.append(thread)
        thread.start()
        self.client.system('shutdown', '服务器已关闭')
        self.client.close()
        self.assertEqual(self.sent[0]['kind'], 'shutdown')
        self.assertTrue(closed)
        self.assertFalse(thread.is_alive())
        self.assertFalse(self.client.system('startup', 'late event'))


class SystemMessageTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.time = 1.0
        self.client = types.SimpleNamespace(system=lambda kind, text: self.sent.append((kind, text)) or True)
        self.reporter = SystemMessages(self.client, clock=lambda: self.time)

    @staticmethod
    def log(text, player=None, from_server=True):
        return types.SimpleNamespace(content=text, player=player, is_from_server=from_server)

    def test_death_and_three_advancement_forms_are_recognized_in_mcdr(self):
        for text in ('Steve was slain by Zombie', 'Steve fell from a high place', 'Steve died'):
            self.assertTrue(self.reporter.log(self.log(text)))
            self.assertEqual(self.sent[-1], ('death', text))
        for verb in ('made the advancement', 'reached the goal', 'completed the challenge'):
            text = f'Steve has {verb} [Stone Age]'
            self.assertTrue(self.reporter.log(self.log(text)))
            self.assertEqual(self.sent[-1], ('advancement', text))

    def test_player_chat_and_unrelated_logs_are_not_system_messages(self):
        text = 'Steve was slain by Zombie'
        self.assertFalse(self.reporter.log(self.log(text, player='Alex')))
        self.assertFalse(self.reporter.log(self.log(text, from_server=False)))
        self.assertFalse(self.reporter.log(self.log('Preparing spawn area: 100%')))
        self.assertEqual(self.sent, [])

    def test_optional_provider_and_log_duplicate_is_suppressed_without_losing_repeated_deaths(self):
        text = 'Steve was slain by Zombie'
        self.reporter.log(self.log(text))
        self.assertFalse(self.reporter.emit('death', ['§a' + text + '§r']))
        self.assertTrue(self.reporter.log(self.log(text)))
        self.assertEqual(len(self.sent), 2)
        self.time += 3
        self.assertTrue(self.reporter.emit('death', text))

    def test_localized_patterns_and_lifecycle_text_are_configurable(self):
        reporter = SystemMessages(self.client, {'startup_text': '开服', 'shutdown_text': '关服',
            'death_patterns': [r'^\w+ 被僵尸杀死了$'], 'advancement_patterns': [r'^\w+ 达成进度.*$']})
        reporter.startup(); reporter.shutdown()
        reporter.log(self.log('Steve 被僵尸杀死了')); reporter.log(self.log('Steve 达成进度[石器时代]'))
        self.assertEqual(self.sent, [('startup', '开服'), ('shutdown', '关服'),
            ('death', 'Steve 被僵尸杀死了'), ('advancement', 'Steve 达成进度[石器时代]')])

    def test_disable_and_invalid_regex(self):
        reporter = SystemMessages(self.client, {'enabled': False})
        self.assertFalse(reporter.startup())
        self.assertFalse(reporter.player_joined('Steve'))
        self.assertFalse(reporter.player_left('Steve'))
        self.assertFalse(reporter.emit('death', 'Steve died'))
        self.assertEqual(self.sent, [])
        with self.assertRaises(Exception):
            SystemMessages(self.client, {'death_patterns': ['[']})

    def test_mcdr_lifecycle_and_provider_hooks_delegate_business_to_reporter(self):
        commands = []
        server = types.SimpleNamespace(execute=commands.append)
        with patch.object(chathub, '_system_messages', self.reporter), patch.object(chathub, '_client', None):
            chathub.on_server_startup(server)
            chathub.on_player_death(server, 'Steve', None, [types.SimpleNamespace(raw='Steve died')])
            chathub.on_player_advancement(server, 'Steve', None, ['Steve has made the advancement [Stone Age]'])
            chathub.on_server_stop(server, 0)
        self.assertEqual([kind for kind, _text in self.sent], ['startup', 'death', 'advancement', 'shutdown'])
        self.assertEqual(commands, [])


class RosterHookTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.presence = []
        self.warnings = []
        self.server = types.SimpleNamespace(
            logger=types.SimpleNamespace(warning=self.warnings.append),
        )
        self.client = types.SimpleNamespace(
            system=lambda kind, text: self.sent.append((kind, text)) or True,
            emit=lambda event: self.presence.append(event) or True,
        )
        self.directory = PlayerDirectory('.', 'offline')
        self.reporter = SystemMessages(self.client)
        patcher = patch.multiple(chathub, _client=self.client, _directory=self.directory,
                                 _server=self.server, _system_messages=self.reporter, _online_players=None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_join_and_leave_only_broadcast_system_messages(self):
        chathub.on_player_joined(self.server, 'Steve', None)
        chathub.on_player_left(self.server, 'Steve')
        self.assertEqual(self.sent, [('join', 'Steve 加入了服务器'), ('leave', 'Steve 离开了服务器')])
        self.assertEqual(self.presence, [])

    def test_missing_uuid_does_not_prevent_join_and_leave_announcements(self):
        with patch.object(self.directory, 'resolve', side_effect=ValueError('missing UUID')):
            chathub.on_player_joined(self.server, 'Steve', None)
            chathub.on_player_left(self.server, 'Steve')
        self.assertEqual(self.sent, [('join', 'Steve 加入了服务器'), ('leave', 'Steve 离开了服务器')])
        self.assertEqual(self.presence, [])
        self.assertEqual(self.warnings, [])

    def test_unsolicited_list_does_not_report_presence_or_announce_joins(self):
        info = SystemMessageTests.log('There are 2 of a max of 20 players online: Steve, Alex')
        chathub.on_info(self.server, info)
        chathub.on_info(self.server, info)
        self.assertEqual(self.presence, [])
        self.assertEqual(self.sent, [])

    def test_rapid_rejoin_is_not_suppressed(self):
        for _ in range(2):
            chathub.on_player_joined(self.server, 'Steve', None)
            chathub.on_player_left(self.server, 'Steve')
        self.assertEqual([kind for kind, _ in self.sent], ['join', 'leave', 'join', 'leave'])

    def test_disabled_announcements_do_not_send_presence(self):
        self.reporter.settings['enabled'] = False
        chathub.on_player_joined(self.server, 'Steve', None)
        chathub.on_player_left(self.server, 'Steve')
        self.assertEqual(self.sent, [])
        self.assertEqual(self.presence, [])

    def test_server_stop_only_announces_shutdown(self):
        chathub.on_player_joined(self.server, 'Steve', None)
        self.sent.clear()
        self.presence.clear()
        chathub.on_server_stop(self.server, 0)
        self.assertEqual(self.sent, [('shutdown', '服务器已关闭')])
        self.assertEqual(self.presence, [])


class OnlinePlayersTests(unittest.TestCase):
    def setUp(self):
        self.commands = []
        self.running = True
        self.directory = PlayerDirectory('.', 'offline')
        self.server = types.SimpleNamespace(is_server_running=lambda: self.running, execute=self.execute)
        self.roster = OnlinePlayers(self.server, self.directory, timeout=0.02)
        self.output = 'There are 1 of a max of 20 players online: Steve'

    def execute(self, command):
        self.commands.append(command)
        if self.output is not None:
            self.roster.log(SystemMessageTests.log(self.output))

    def test_every_query_reads_a_fresh_complete_list_including_empty(self):
        self.assertEqual(self.roster.query(), [self.directory.resolve('Steve')])
        self.output = 'There are 0 of a max of 20 players online:'
        self.assertEqual(self.roster.query(), [])
        self.assertEqual(self.commands, ['list', 'list'])

    def test_stopped_server_returns_empty_without_command(self):
        self.running = False
        self.assertEqual(self.roster.query(), [])
        self.assertEqual(self.commands, [])

    def test_timeout_partial_output_and_unknown_uuid_fail_not_empty(self):
        self.output = None
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            self.roster.query()
        self.output = 'There are 2 of a max of 20 players online: Steve'
        with self.assertRaisesRegex(RuntimeError, 'Incomplete'):
            self.roster.query()
        self.output = 'There are 1 of a max of 20 players online: Steve'
        with patch.object(self.directory, 'resolve', side_effect=ValueError('missing UUID')):
            with self.assertRaisesRegex(RuntimeError, 'missing UUID'):
                self.roster.query()
        self.assertEqual(self.roster.query(), [self.directory.resolve('Steve')])

    def test_unsolicited_or_player_log_is_not_a_roster(self):
        self.roster.log(SystemMessageTests.log(self.output))
        self.output = None
        self.server.execute = lambda command: self.roster.log(SystemMessageTests.log(
            'There are 1 of a max of 20 players online: Steve', player='Steve'))
        with self.assertRaises(RuntimeError):
            self.roster.query()

    def test_shutdown_releases_waiting_query(self):
        self.output = None
        self.server.execute = lambda command: self.roster.stopped()
        self.assertEqual(self.roster.query(), [])


if __name__ == "__main__":
    unittest.main()
