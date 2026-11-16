#!/usr/bin/env python3
"""Serve the home game and store private player progress outside its web root."""
import argparse
import json
import math
import sqlite3
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4


AVATARS = {"🌸", "⭐", "🐰", "🦊"}
PREFERENCES = {
    "bunny-russian-class", "bunny-russian-count", "bunny-russian-grade-1",
    "bunny-russian-mistakes", "bunny-russian-studied-2", "bunny-russian-studied-4",
}
REWARD_PRICES = {"mushroom": 5, "star": 6, "koopa": 7, "mario": 10,
                 "chip": 7, "dale": 7, "darkwing": 12}
MISSION_REWARDS = ("koopa", "mushroom", "mario", "chip", "dale", "darkwing")
DAILY_MISSIONS = ("koopa", "mushroom", "mario")


def daily_mission():
    today = datetime.now(timezone(timedelta(hours=3))).date()
    return today.isoformat(), DAILY_MISSIONS[today.toordinal() % len(DAILY_MISSIONS)]


def reward_defaults(profile):
    profile.setdefault("coins", 0)
    profile.setdefault("reviewWins", 0)
    profile.setdefault("dailyDone", "")
    return profile


def player_view(player_id, name, avatar, profile):
    day, mission = daily_mission()
    return dict(id=player_id, name=name, avatar=avatar, **profile,
                rewards=dict(prices=REWARD_PRICES, day=day, mission=mission))


def initial_profile():
    return reward_defaults({"preferences": {}, "rounds": 0, "correct": 0, "topics": [], "best": {}, "stickers": {}})


def award(profile, sticker):
    if sticker not in profile["stickers"]:
        profile["stickers"][sticker] = None


def apply_round(profile, data):
    score, total, topics, review = (data.get(key) for key in ("score", "total", "topics", "review"))
    corrected = data.get("corrected", 0)
    mission = data.get("mission")
    daily = data.get("daily")
    if (type(score) is not int or total not in (10, 50, 100) or not 0 <= score <= total
            or not isinstance(topics, list) or not 1 <= len(topics) <= 64
            or not all(isinstance(topic, str) and topic.isascii() and topic.isalnum()
                       and 1 <= len(topic) <= 40 for topic in topics)
            or type(review) is not bool or type(corrected) is not int or not 0 <= corrected <= total - score
            or (mission is not None and (not isinstance(mission, str) or mission not in MISSION_REWARDS or total != 10 or review))
            or (daily is not None and (mission is None or not isinstance(daily, str) or len(daily) != 10))):
        raise ValueError("Некорректный результат тренировки.")
    profile["rounds"] += 1
    profile["correct"] += score
    profile["topics"] = sorted(set(profile["topics"] + topics))[:100]
    award(profile, "start")
    if len(profile["topics"]) >= 3:
        award(profile, "books")
    if mission:
        award(profile, mission)
        today, offered = daily_mission()
        if daily == today and mission in (offered, "koopa") and profile["dailyDone"] != today:
            profile["dailyDone"] = today
            profile["coins"] += 2
            award(profile, "coin")
        return

    profile["coins"] += 1
    award(profile, "coin")
    if review and score > 0:
        award(profile, "detective")
    if review:
        profile["reviewWins"] = min(3, profile["reviewWins"] + score + corrected)
        if profile["reviewWins"] >= 3:
            award(profile, "star")
    if len(topics) == 1:
        topic = topics[0]
        percentage = score * 100 // total
        previous = profile["best"].get(topic)
        if previous is not None and percentage > previous:
            award(profile, "rocket")
        if len(profile["best"]) < 100 or previous is not None:
            profile["best"][topic] = max(percentage, previous or 0)


class BunnyHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, database, allowed_hosts, directory, **kwargs):
        self.database = database
        self.allowed_hosts = allowed_hosts
        super().__init__(*args, directory=directory, **kwargs)

    def list_directory(self, _path):
        self.send_error(404)
        return None

    def do_GET(self):
        if urlsplit(self.path).path.startswith("/api/"):
            self.handle_api()
        else:
            super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path.startswith("/api/"):
            self.send_error(405)
        else:
            super().do_HEAD()

    def do_POST(self):
        self.handle_api()

    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self):
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        if host not in self.allowed_hosts or (origin and origin != "http://" + host):
            self.respond(403, {"error": "Откройте игру по домашнему адресу."})
            return
        try:
            data = None
            if self.command == "POST":
                size = int(self.headers.get("Content-Length", "0"))
                if self.headers.get_content_type() != "application/json" or not 0 < size <= 32768:
                    raise ValueError("Неверный формат запроса.")
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError("Неверный формат запроса.")
            with closing(sqlite3.connect(self.database, timeout=5)) as db, db:
                status, result = self.route(db, urlsplit(self.path).path, data)
            self.respond(status, result)
        except (ValueError, UnicodeError) as error:
            self.respond(400, {"error": str(error)})
        except sqlite3.Error:
            self.respond(503, {"error": "Прогресс временно недоступен. Попробуйте ещё раз."})

    def route(self, db, path, data):
        if path == "/api/players":
            if data is None:
                return 200, [dict(id=i, name=n, avatar=a) for i, n, a in db.execute(
                    "SELECT id,name,avatar FROM players ORDER BY rowid")]
            name, avatar = data.get("name"), data.get("avatar")
            if not isinstance(name, str) or not isinstance(avatar, str) or avatar not in AVATARS:
                raise ValueError("Выберите аватар и введите имя.")
            name = " ".join(unicodedata.normalize("NFC", name).split())
            if not 1 <= len(name) <= 20 or any(unicodedata.category(c).startswith("C") for c in name):
                raise ValueError("Введите имя длиной от 1 до 20 символов.")
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT count(*) FROM players").fetchone()[0] >= 12:
                raise ValueError("В игре уже 12 профилей.")
            if any(other.casefold() == name.casefold() for (other,) in db.execute("SELECT name FROM players")):
                raise ValueError("Такое имя уже есть. Выберите его в списке.")
            player_id = uuid4().hex
            profile = initial_profile()
            db.execute("INSERT INTO players VALUES (?, ?, ?, ?)", (player_id, name, avatar, json.dumps(profile)))
            return 201, player_view(player_id, name, avatar, profile)

        parts = path.split("/")
        if len(parts) != 4 or parts[1:3] != ["api", "players"]:
            return 404, {"error": "Страница не найдена."}
        player_id = parts[3]
        if data is not None:
            db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT name,avatar,progress FROM players WHERE id=?", (player_id,)).fetchone()
        if row is None:
            return 404, {"error": "Игрок не найден."}
        name, avatar, saved = row
        profile = reward_defaults(json.loads(saved))
        if data is not None:
            self.update(db, player_id, profile, data)
            db.execute("UPDATE players SET progress=? WHERE id=?", (json.dumps(profile), player_id))
        return 200, player_view(player_id, name, avatar, profile)

    @staticmethod
    def update(db, player_id, profile, data):
        kind = data.get("kind")
        if kind == "preference":
            key, value = data.get("key"), data.get("value")
            if not isinstance(key, str) or key not in PREFERENCES or not isinstance(value, str) or len(value) > 8000:
                raise ValueError("Некорректная настройка.")
            profile["preferences"][key] = value
        elif kind == "round":
            operation = data.get("id")
            if not isinstance(operation, str) or len(operation) != 36 or str(UUID(operation)) != operation:
                raise ValueError("Некорректный номер раунда.")
            inserted = db.execute("INSERT OR IGNORE INTO rounds VALUES (?, ?)", (player_id, operation)).rowcount
            if inserted:
                apply_round(profile, data)
        elif kind == "sticker":
            sticker, x, y = (data.get(key) for key in ("sticker", "x", "y"))
            if not isinstance(sticker, str) or sticker not in profile["stickers"] or not all(
                type(value) in (int, float) and 0 <= value <= 100 and math.isfinite(value) for value in (x, y)
            ):
                raise ValueError("Выберите полученную наклейку и место на странице.")
            if profile["stickers"][sticker] is None:
                profile["stickers"][sticker] = {"x": round(x, 2), "y": round(y, 2)}
        elif kind == "redeem":
            sticker = data.get("sticker")
            if not isinstance(sticker, str) or sticker not in REWARD_PRICES:
                raise ValueError("Выберите наклейку из коллекции.")
            cost = REWARD_PRICES[sticker]
            if sticker not in profile["stickers"] and profile["coins"] >= cost:
                profile["coins"] -= cost
                award(profile, sticker)
        else:
            raise ValueError("Неизвестное действие.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", default=8097, type=int)
    parser.add_argument("--host", action="append", default=[])
    options = parser.parse_args()
    if options.database.resolve().is_relative_to(options.directory.resolve()):
        parser.error("The database must be outside the web directory.")
    options.database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(options.database)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, progress TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS rounds (player TEXT, id TEXT, PRIMARY KEY(player,id))")
    allowed_hosts = {f"{host}:{options.port}" for host in ["127.0.0.1", "localhost", *options.host]}
    handler = partial(BunnyHandler, database=options.database, directory=options.directory, allowed_hosts=allowed_hosts)
    with ThreadingHTTPServer((options.bind, options.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
