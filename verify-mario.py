"""Exercise private Mario grants through a real HTTP server and isolated database."""
import http.cookiejar
import importlib.util
import json
import sqlite3
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location("bunny", ROOT / "tool/bunny-server.py")
bunny = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bunny)


class Quiet(bunny.BunnyHandler):
    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory(prefix="bunny-mario-") as directory:
    database = Path(directory) / "progress.sqlite"
    bunny.initialize_database(database)
    server = bunny.ThreadingHTTPServer(("127.0.0.1", 0), partial(
        Quiet, database=database, directory=ROOT, allowed_hosts=set()))
    server.RequestHandlerClass.keywords["allowed_hosts"] = {f"127.0.0.1:{server.server_port}"}
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()

    def client():
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(browser, path, data=None):
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/api/{path}?rewards=catalog-v1", body,
                                     {"Content-Type": "application/json"})
        try:
            response = browser.open(req)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.code, json.loads(response.read())

    anonymous, parent, child, other, second = [client() for _ in range(5)]
    try:
        assert request(anonymous, "mario")[0] == 401
        code = database.with_suffix(".setup-code").read_text().strip()
        assert request(parent, "auth/setup", dict(code=code, name="Родитель", avatar="⭐", login="parent", password="Parent-test-123"))[0] == 200
        for name in ("child", "other"):
            assert request(parent, "auth/accounts", dict(name=name, avatar="🐰", login=name, password="Child-test-123"))[0] == 200
        children = request(parent, "players")[1]
        child_id = next(item["id"] for item in children if item["login"] == "child")
        for browser, login in ((child, "child"), (other, "other"), (second, "child")):
            assert request(browser, "auth/login", dict(login=login, password="Child-test-123"))[0] == 200
        assert request(child, "mario", dict(action="start", admin=True, unlimited=True))[0] == 403
        admin = request(parent, "mario", dict(action="start"))[1]
        assert admin["admin"] and admin["expires"] is None and admin["tickets"] == 0
        assert request(child, "mario", dict(action="heartbeat", id=admin["id"]))[0] == 403

        event = dict(kind="round", id=str(uuid4()), score=8, total=10, topics=["add"], review=False)
        path = "players/" + child_id
        assert request(child, path, event)[0] == 200
        assert request(child, path, event)[0] == 200
        assert request(child, "mario")[1]["tickets"] == 1
        before = request(child, path)[1]
        with ThreadPoolExecutor(max_workers=2) as pool:
            starts = list(pool.map(lambda _: request(child, "mario", dict(action="start")), range(2)))
        assert all(status == 200 for status, _ in starts)
        first, retry = [result for _, result in starts]
        assert first["id"] == retry["id"] and first["expires"] == retry["expires"]
        assert not first["admin"] and 599 <= first["remaining"] <= 600 and first["tickets"] == 0
        assert request(child, path)[1] == before, "Playing must not alter school progress or sticker layout"
        assert request(other, "mario", dict(action="start"))[0] == 403
        assert request(other, "mario", dict(action="heartbeat", id=first["id"]))[0] == 403
        assert request(child, "mario", dict(action="heartbeat", id="forged"))[0] == 403
        assert request(child, path, event)[0] == 200
        assert request(child, "mario")[1]["tickets"] == 0
        invalid = dict(event, id=str(uuid4()), total=9)
        assert request(child, path, invalid)[0] == 400
        assert request(child, "mario")[1]["tickets"] == 0

        transferred = request(second, "mario", dict(action="start"))[1]
        assert transferred["id"] != first["id"] and transferred["expires"] == first["expires"]
        assert request(child, "mario", dict(action="heartbeat", id=first["id"]))[0] == 403
        assert request(second, "mario", dict(action="heartbeat", id=transferred["id"]))[0] == 200
        # A native pause freezes the earned budget on the server, even past the old deadline.
        base = time.time()
        with patch.object(bunny.time, 'time', return_value=base + 90):
            paused = request(second, "mario", dict(action="pause", id=transferred['id']))[1]
            assert paused['paused'] and paused['expires'] is None and 508 <= paused['remaining'] <= 511
            held = paused['remaining']
        with patch.object(bunny.time, 'time', return_value=base + 3690):
            bunny.initialize_database(database)  # Restart/migration preserves a paused session.
            for action in ('heartbeat', 'pause', 'pause'):
                again = request(second, "mario", dict(action=action, id=transferred['id']))[1]
                assert again['paused'] and again['remaining'] == held
            assert request(second, "mario")[1]['remaining'] == held
            assert request(other, "mario", dict(action="resume", id=transferred['id']))[0] == 403
            assert request(second, "mario", dict(action="resume", id='forged'))[0] == 403
            # Transfer while paused preserves the budget and revokes the previous holder.
            moved = request(child, "mario", dict(action="start"))[1]
            assert moved['id'] != transferred['id'] and moved['paused'] and moved['remaining'] == held
            assert request(second, "mario", dict(action="resume", id=transferred['id']))[0] == 403
            moved = request(second, "mario", dict(action="start"))[1]
            transferred = moved
            assert moved['paused'] and moved['remaining'] == held
            resumed = request(second, "mario", dict(action="resume", id=moved['id']))[1]
            assert not resumed['paused'] and resumed['remaining'] == held
            assert request(second, "mario", dict(action="resume", id=moved['id']))[1]['expires'] == resumed['expires']
        with patch.object(bunny.time, 'time', return_value=base + 3720):
            running = request(second, "mario", dict(action="heartbeat", id=transferred['id']))[1]
            assert abs(running['remaining'] - (held-30)) < .001
            assert request(second, "mario", dict(action="resume", id=transferred['id']))[1]['remaining'] == running['remaining']
        assert request(second, path)[1] == before, 'Pause/resume cannot alter school progress or stickers'
        assert request(second, "mario")[1]['tickets'] == 0, 'Pause/resume never mints a new ticket'
        with sqlite3.connect(database) as db:
            db.execute("UPDATE mario_sessions SET expires=? WHERE player=?", (time.time()-1, child_id))
        assert request(second, "mario", dict(action="heartbeat", id=transferred["id"]))[0] == 403
        assert not request(second, "mario")[1]["canResume"]
        assert request(second, "mario", dict(action="start"))[0] == 403
        next_round = dict(event, id=str(uuid4()))
        assert request(second, path, next_round)[0] == 200
        next_play = request(second, "mario", dict(action="start"))[1]
        assert next_play["id"] != transferred["id"] and next_play["remaining"] > 599
        assert request(second, "auth/logout", {})[0] == 200
        assert request(second, "mario", dict(action="heartbeat", id=next_play["id"]))[0] == 401
        print("PASS Mario: server pause budget, repeated pause/resume deduplication, hour-long pause, paused device transfer, active-time debit, unchanged progress; admin-only free access, earned 600 seconds, profile isolation, concurrent/double-start, duplicate/invalid rounds, device transfer, expiry, new earned launch, logout and unchanged sticker positions")
    finally:
        server.shutdown()
        server.server_close()
        worker.join()
