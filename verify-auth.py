"""Exercise login and profile isolation through the real HTTP API."""
import http.cookiejar
import importlib.util
import json
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.request
from functools import partial
from pathlib import Path
from uuid import uuid4

spec = importlib.util.spec_from_file_location("bunny", Path(__file__).parent / "tool/bunny-server.py")
bunny = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bunny)


class QuietHandler(bunny.BunnyHandler):
    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory(prefix="bunny-auth-") as directory:
    database = Path(directory) / "progress.sqlite"
    # An existing profile from before login was introduced.
    original = bunny.initial_profile()
    original.update(rounds=12, correct=87, coins=8, stickers={"chip": {"x": 20, "y": 30}})
    original.pop("albumPages")
    original.pop("albumPage")
    with sqlite3.connect(database) as db:
        db.execute("CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, progress TEXT)")
        db.execute("INSERT INTO players VALUES (?,?,?,?)", ("old-parent", "Родитель", "⭐", json.dumps(original)))
        child_profile = dict(bunny.initial_profile(), schoolClasses=[1, 2])
        child_profile.pop("albumPages")
        child_profile.pop("albumPage")
        db.execute("INSERT INTO players VALUES (?,?,?,?)", ("old-child", "Ребёнок", "🐰", json.dumps(child_profile)))
    bunny.initialize_database(database)
    setup_code = database.with_suffix(".setup-code").read_text().strip()
    assert database.with_suffix(".setup-code").stat().st_mode & 0o777 == 0o600
    server = bunny.ThreadingHTTPServer(("127.0.0.1", 0), partial(
        QuietHandler, database=database, directory=Path(__file__).parent, allowed_hosts=set()))
    server.RequestHandlerClass.keywords["allowed_hosts"] = {"127.0.0.1:" + str(server.server_port)}
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = "http://127.0.0.1:" + str(server.server_port)

    def client():
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(browser, path, data=None, headers=None):
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(base + "/api/" + path + "?rewards=characters", body, request_headers)
        try:
            response = browser.open(req)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, json.loads(response.read()), response.headers

    anonymous, parent, child, second_child = [client() for _ in range(4)]
    try:
        assert request(anonymous, "players/old-parent")[0] == 401
        status = request(anonymous, "auth/status")[1]
        assert not status["configured"] and status["player"] is None
        setup = dict(player="old-parent", login="parent", password="Parent-test-123", code="wrong")
        assert request(parent, "auth/setup", setup)[0] == 403
        setup["code"] = setup_code
        code, _, headers = request(parent, "auth/setup", setup)
        assert code == 200 and "HttpOnly" in headers["Set-Cookie"] and "Max-Age" not in headers["Set-Cookie"]
        assert request(parent, "auth/status")[1]["parent"]
        assert request(parent, "players/old-parent")[1]["stickers"] == original["stickers"]
        assert request(parent, "players/old-parent")[1]["rounds"] == 12
        assert request(anonymous, "auth/setup", setup)[0] == 409

        child_account = dict(player="old-child", login="child", password="Child-test-123")
        assert request(parent, "auth/accounts", child_account)[0] == 200
        assert request(anonymous, "auth/accounts", child_account)[0] == 403
        assert request(child, "auth/login", dict(login="child", password="wrong-password"))[0] == 401
        code, _, headers = request(child, "auth/login", dict(login="CHILD", password="Child-test-123", remember=True))
        assert code == 200 and "Max-Age=2592000" in headers["Set-Cookie"]
        assert request(child, "players/old-child")[0] == 200
        assert request(child, "players/old-child")[1]["schoolClasses"] == [1, 2]
        assert request(child, "players/old-child", dict(kind="preference", key="bunny-russian-class", value="2"))[0] == 200
        assert request(child, "players/old-child", dict(kind="preference", key="bunny-russian-class", value="3"))[0] == 400
        assert request(child, "players/old-child", dict(kind="preference", key="schoolClasses", value="[1,2,3,4]"))[0] == 400
        for subject in ("math", "english", "world"):
            key = f"bunny-school-{subject}-class"
            assert request(child, "players/old-child", dict(kind="preference", key=key, value="2"))[0] == 200
            assert request(child, "players/old-child", dict(kind="preference", key=key, value="4"))[0] == 400
            assert request(child, "players/old-child", dict(kind="preference", key=key, value="1"))[0] == 400
            assert request(child, "players/old-child", dict(kind="preference", key=f"bunny-school-{subject}-studied2", value='["example"]'))[0] == 200
        assert request(child, "players/old-parent")[0] == 403
        assert request(child, "players/old-parent", dict(kind="redeem", sticker="mario"))[0] == 403
        assert request(child, "auth/accounts", dict(name="Other", avatar="🦊", login="other", password="Other-test-123"))[0] == 403
        assert request(child, "players/old-child", dict(kind="redeem", sticker="chip"), {"Origin": "http://evil.example"})[0] == 403
        assert request(anonymous, "players/old-child", headers={"Cookie": "bunny_session=forged"})[0] == 401

        event = dict(kind="round", id=str(uuid4()), score=9, total=10, topics=["compare"], review=False)
        assert request(child, "players/old-child", event)[0] == 200
        result = request(child, "players/old-child", event)[1]
        assert result["rounds"] == 1 and result["coins"] == 1
        # Placing and moving an earned sticker changes only its coordinates.
        for x, y in [(25, 35), (75, 60), (0, 100), (45.125, 55.555)]:
            code, moved, _ = request(child, "players/old-child", dict(kind="sticker", sticker="start", x=x, y=y))
            assert code == 200 and moved["stickers"]["start"] == dict(x=round(x, 2), y=round(y, 2))
            assert moved["rounds"] == 1 and moved["coins"] == 1 and moved["correct"] == 9
        for invalid in [dict(sticker="mario", x=20, y=30), dict(sticker="start", x=-1, y=30),
                        dict(sticker="start", x=101, y=30), dict(sticker="start", x=True, y=30),
                        dict(sticker="start", x="25", y=30)]:
            assert request(child, "players/old-child", dict(kind="sticker", **invalid))[0] == 400
        assert request(child, "players/old-child")[1]["stickers"]["start"] == moved["stickers"]["start"]

        # Album layout is private, durable, and compatible with older x/y-only tabs.
        assert request(child, "players/old-child")[1]["albumPages"] == 1
        assert request(child, "players/old-child", dict(kind="album-page", pages=3, page=2))[0] == 200
        layout = dict(x=42.25, y=67.5, page=2, scale=1.5, rotation=30)
        status, changed, _ = request(child, "players/old-child", dict(kind="sticker", sticker="start", **layout))
        assert status == 200 and changed["stickers"]["start"] == layout
        status, changed, _ = request(child, "players/old-child", dict(kind="sticker", sticker="start", x=30, y=40))
        layout.update(x=30, y=40)
        assert status == 200 and changed["stickers"]["start"] == layout
        for fields in (dict(page=3), dict(page=True), dict(scale=0.1), dict(scale=1.51),
                       dict(rotation=31), dict(rotation=float("nan")), dict(scale=True)):
            invalid = dict(layout, **fields)
            assert request(child, "players/old-child", dict(kind="sticker", sticker="start", **invalid))[0] == 400
        for pages, page in ((0, 0), (13, 0), (3, 3), (3, -1), (True, 0)):
            assert request(child, "players/old-child", dict(kind="album-page", pages=pages, page=page))[0] == 400
        assert request(child, "players/old-child")[1]["stickers"]["start"] == layout
        # Retry after an offline page addition cannot shrink the album.
        status, changed, _ = request(child, "players/old-child", dict(kind="album-page", pages=1, page=0))
        assert status == 200 and changed["albumPages"] == 3
        assert request(child, "players/old-child", dict(kind="sticker", sticker="start", placed=False))[1]["stickers"]["start"] is None
        changed = request(child, "players/old-child", dict(kind="sticker", sticker="start", **layout))[1]
        assert changed["stickers"]["start"] == layout
        assert (changed["rounds"], changed["coins"], changed["correct"]) == (1, 1, 9)

        assert request(second_child, "auth/login", dict(login="child", password="Child-test-123"))[0] == 200
        reopened = request(second_child, "players/old-child")[1]
        assert reopened["stickers"]["start"] == layout and reopened["albumPages"] == 3
        assert request(parent, "auth/accounts", dict(child_account, password="New-child-test-123"))[0] == 200
        assert request(child, "players/old-child")[0] == 401
        assert request(second_child, "players/old-child")[0] == 401
        assert request(child, "auth/login", dict(login="child", password="Child-test-123"))[0] == 401
        assert request(child, "auth/login", dict(login="child", password="New-child-test-123"))[0] == 200
        assert request(child, "players/old-child")[1]["rounds"] == 1

        # Changing players replaces the browser session and revokes its old token.
        assert request(parent, "auth/accounts", dict(name="Новый", avatar="🦊", login="new-player", password="New-player-123"))[0] == 200
        new_id = next(item["id"] for item in request(parent, "players")[1] if item["login"] == "new-player")
        old_token = next(cookie.value for handler in child.handlers
                         if isinstance(handler, urllib.request.HTTPCookieProcessor)
                         for cookie in handler.cookiejar if cookie.name == "bunny_session")
        assert request(child, "auth/login", dict(login="new-player", password="New-player-123"))[0] == 200
        assert request(child, "players/old-child")[0] == 403
        assert request(child, "players/" + new_id)[0] == 200
        assert request(anonymous, "players/old-child", headers={"Cookie": "bunny_session=" + old_token})[0] == 401
        assert request(child, "auth/logout", {})[0] == 200
        assert request(child, "auth/status")[1]["player"] is None

        with sqlite3.connect(database) as db:
            rows = db.execute("SELECT salt,digest FROM accounts").fetchall()
            assert len({salt for salt, _ in rows}) == len(rows)
            assert all(len(digest) == 64 for _, digest in rows)
            db.execute("UPDATE sessions SET expires=?", (time.time() - 1,))
        assert request(parent, "players/old-parent")[0] == 401
        assert request(anonymous, "auth/login", dict(login="parent", password="Parent-test-123"))[0] == 200
        assert request(anonymous, "players/old-parent")[1]["coins"] == 8
        for _ in range(5):
            assert request(child, "auth/login", dict(login="child", password="incorrect"))[0] == 401
        assert request(child, "auth/login", dict(login="child", password="New-child-test-123"))[0] == 429
        bunny.initialize_database(database)
        assert request(anonymous, "auth/status")[1]["configured"]
        print("PASS migration, first parent setup, login, cookies, profile isolation, CSRF, duplicate rewards, password reset, account creation, switch, logout, expiry, hashes and attempt limits")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
