#!/usr/bin/env python3
"""Serve the home game and store private player progress outside its web root."""
import argparse
import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import time
import unicodedata
from contextlib import closing
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from http.cookies import CookieError, SimpleCookie
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
PASSWORD_ROUNDS = 600000


def normalize_login(value):
    if not isinstance(value, str):
        raise ValueError("Введите логин.")
    login = unicodedata.normalize("NFKC", value).strip().casefold()
    if not 3 <= len(login) <= 32 or not all(c.isalnum() or c in "._-" for c in login):
        raise ValueError("Логин — от 3 до 32 букв, цифр, точек, дефисов или подчёркиваний.")
    return login


def validate_password(value):
    if not isinstance(value, str) or not 8 <= len(value) <= 128:
        raise ValueError("Пароль — от 8 до 128 символов.")
    return value


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PASSWORD_ROUNDS).hex()


def token_digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def initialize_database(database):
    with closing(sqlite3.connect(database)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT, avatar TEXT, progress TEXT)")
        db.execute("CREATE TABLE IF NOT EXISTS rounds (player TEXT, id TEXT, PRIMARY KEY(player,id))")
        db.execute("CREATE TABLE IF NOT EXISTS accounts (player TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, digest TEXT NOT NULL, parent INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player TEXT NOT NULL, expires REAL NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS auth_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS login_attempts (scope TEXT PRIMARY KEY, failures INTEGER, updated REAL, blocked REAL)")
        if not db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone():
            setup_file = database.with_suffix(".setup-code")
            if setup_file.exists():
                code = setup_file.read_text().strip()
            else:
                code = secrets.token_urlsafe(24)
                descriptor = os.open(setup_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "w") as output:
                    output.write(code + "\n")
            db.execute("INSERT OR REPLACE INTO auth_settings VALUES ('setup',?)", (token_digest(code),))


def daily_mission():
    today = datetime.now(timezone(timedelta(hours=3))).date()
    return today.isoformat(), DAILY_MISSIONS[today.toordinal() % len(DAILY_MISSIONS)]


def reward_defaults(profile):
    profile.setdefault("coins", 0)
    profile.setdefault("reviewWins", 0)
    profile.setdefault("dailyDone", "")
    return profile


def school_classes(profile):
    saved = profile.get("schoolClasses")
    if not isinstance(saved, list):
        return [1, 2, 3, 4]
    valid = sorted({grade for grade in saved if type(grade) is int and grade in (1, 2, 3, 4)})
    return valid or [1, 2, 3, 4]


def player_view(player_id, name, avatar, profile, characters=False):
    day, mission = daily_mission()
    prices = dict(REWARD_PRICES)
    visible = dict(profile)
    visible["schoolClasses"] = school_classes(profile)
    if not characters:
        # Older open tabs know only the original collections.
        new_stickers = {"chip", "dale", "darkwing"}
        prices = {key: cost for key, cost in prices.items() if key not in new_stickers}
        visible["stickers"] = {key: value for key, value in profile["stickers"].items() if key not in new_stickers}
    return dict(id=player_id, name=name, avatar=avatar, **visible,
                rewards=dict(prices=prices, day=day, mission=mission))


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
        if getattr(self, "auth_cookie", None):
            self.send_header("Set-Cookie", self.auth_cookie)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self):
        self.auth_cookie = None
        self.character_rewards = urlsplit(self.path).query == "rewards=characters"
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
                if data is not None:
                    db.execute("BEGIN IMMEDIATE")
                status, result = self.route(db, urlsplit(self.path).path, data)
            self.respond(status, result)
        except (ValueError, UnicodeError) as error:
            self.respond(400, {"error": str(error)})
        except sqlite3.Error:
            self.respond(503, {"error": "Прогресс временно недоступен. Попробуйте ещё раз."})

    def session_token(self):
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            return cookies["bunny_session"].value if "bunny_session" in cookies else ""
        except CookieError:
            return ""

    def account(self, db):
        token = self.session_token()
        return db.execute(
            "SELECT a.player,a.login,a.parent FROM sessions s JOIN accounts a ON a.player=s.player "
            "WHERE s.token=? AND s.expires>?", (token_digest(token), time.time())
        ).fetchone() if token else None

    def sign_in(self, db, player_id, remember):
        db.execute("DELETE FROM sessions WHERE token=? OR expires<=?", (token_digest(self.session_token()), time.time()))
        token = secrets.token_urlsafe(32)
        duration = 30 * 86400 if remember else 12 * 3600
        db.execute("INSERT INTO sessions VALUES (?,?,?)", (token_digest(token), player_id, time.time() + duration))
        self.auth_cookie = "bunny_session=" + token + "; HttpOnly; SameSite=Strict; Path=/"
        if remember:
            self.auth_cookie += "; Max-Age=" + str(duration)

    def auth_status(self, db):
        account = self.account(db)
        profile = None
        if account:
            name, avatar, saved = db.execute("SELECT name,avatar,progress FROM players WHERE id=?", (account[0],)).fetchone()
            profile = player_view(account[0], name, avatar, reward_defaults(json.loads(saved)), self.character_rewards)
        return dict(configured=bool(db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone()),
                    player=profile, parent=bool(account and account[2]), login=account[1] if account else None)

    def auth_scope(self, action, login=""):
        return action + ":" + self.client_address[0] + ":" + login

    def blocked(self, db, scope):
        row = db.execute("SELECT blocked FROM login_attempts WHERE scope=?", (scope,)).fetchone()
        return bool(row and row[0] > time.time())

    def failed_login(self, db, scope):
        now = time.time()
        db.execute("DELETE FROM login_attempts WHERE updated<?", (now - 86400,))
        previous = db.execute("SELECT failures,updated FROM login_attempts WHERE scope=?", (scope,)).fetchone()
        failures = previous[0] + 1 if previous and previous[1] > now - 600 else 1
        db.execute("INSERT OR REPLACE INTO login_attempts VALUES (?,?,?,?)",
                   (scope, failures, now, now + 300 if failures >= 5 else 0))

    @staticmethod
    def account_list(db):
        return [dict(id=p, name=n, avatar=a, login=login, ready=bool(login))
                for p, n, a, login in db.execute(
                    "SELECT p.id,p.name,p.avatar,a.login FROM players p LEFT JOIN accounts a ON a.player=p.id ORDER BY p.rowid")]

    @staticmethod
    def create_player(db, data):
        name, avatar = data.get("name"), data.get("avatar")
        if not isinstance(name, str) or not isinstance(avatar, str) or avatar not in AVATARS:
            raise ValueError("Выберите аватар и введите имя.")
        name = " ".join(unicodedata.normalize("NFC", name).split())
        if not 1 <= len(name) <= 20 or any(unicodedata.category(c).startswith("C") for c in name):
            raise ValueError("Введите имя длиной от 1 до 20 символов.")
        if db.execute("SELECT count(*) FROM players").fetchone()[0] >= 12:
            raise ValueError("В игре уже 12 профилей.")
        if any(other.casefold() == name.casefold() for (other,) in db.execute("SELECT name FROM players")):
            raise ValueError("Такое имя уже есть. Выберите его в списке.")
        player_id = uuid4().hex
        db.execute("INSERT INTO players VALUES (?,?,?,?)", (player_id, name, avatar, json.dumps(initial_profile())))
        return player_id

    def save_account(self, db, data, parent=False):
        login = normalize_login(data.get("login"))
        password = validate_password(data.get("password"))
        player = data.get("player")
        if player is not None and (not isinstance(player, str) or not db.execute("SELECT 1 FROM players WHERE id=?", (player,)).fetchone()):
            raise ValueError("Выберите существующий профиль.")
        other = db.execute("SELECT player FROM accounts WHERE login=?", (login,)).fetchone()
        if other and other[0] != player:
            raise ValueError("Этот логин уже занят.")
        if player is None:
            player = self.create_player(db, data)
        salt = secrets.token_hex(16)
        digest = password_digest(password, salt)
        existing = db.execute("SELECT parent FROM accounts WHERE player=?", (player,)).fetchone()
        db.execute("INSERT OR REPLACE INTO accounts VALUES (?,?,?,?,?)",
                   (player, login, salt, digest, int(parent or bool(existing and existing[0]))))
        db.execute("DELETE FROM sessions WHERE player=?", (player,))
        return player

    def route_auth(self, db, path, data):
        if path == "/api/auth/status" and data is None:
            return 200, self.auth_status(db)
        if data is None:
            return 405, {"error": "Используйте форму входа."}
        if path == "/api/auth/logout":
            db.execute("DELETE FROM sessions WHERE token=?", (token_digest(self.session_token()),))
            self.auth_cookie = "bunny_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
            return 200, {"ok": True}
        if path == "/api/auth/login":
            login = normalize_login(data.get("login"))
            password = validate_password(data.get("password"))
            scope = self.auth_scope("login", login)
            if self.blocked(db, scope) or self.blocked(db, self.auth_scope("login")):
                return 429, {"error": "Слишком много попыток. Попробуйте через 5 минут."}
            row = db.execute("SELECT player,salt,digest FROM accounts WHERE login=?", (login,)).fetchone()
            digest = password_digest(password, row[1] if row else "00" * 16)
            if not row or not hmac.compare_digest(row[2], digest):
                self.failed_login(db, scope)
                self.failed_login(db, self.auth_scope("login"))
                return 401, {"error": "Неверный логин или пароль."}
            db.execute("DELETE FROM login_attempts WHERE scope IN (?,?)", (scope, self.auth_scope("login")))
            self.sign_in(db, row[0], data.get("remember") is True)
            # The new cookie is sent with the response and is not in the request yet.
            return 200, {"ok": True}
        if path == "/api/auth/setup":
            if db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone():
                return 409, {"error": "Родительский доступ уже настроен. Войдите с паролем."}
            scope = self.auth_scope("setup")
            if self.blocked(db, scope):
                return 429, {"error": "Слишком много попыток. Попробуйте через 5 минут."}
            row = db.execute("SELECT value FROM auth_settings WHERE key='setup'").fetchone()
            code = data.get("code")
            if not row or not isinstance(code, str) or not hmac.compare_digest(row[0], token_digest(code.strip())):
                self.failed_login(db, scope)
                return 403, {"error": "Неверный код первоначальной настройки."}
            player = self.save_account(db, data, parent=True)
            db.execute("DELETE FROM auth_settings WHERE key='setup'")
            self.sign_in(db, player, data.get("remember") is True)
            return 200, {"ok": True}
        if path == "/api/auth/accounts":
            account = self.account(db)
            if not account or not account[2]:
                return 403, {"error": "Войдите в родительский профиль."}
            self.save_account(db, data)
            return 200, {"ok": True}
        return 404, {"error": "Страница не найдена."}

    def route(self, db, path, data):
        if path.startswith("/api/auth/"):
            return self.route_auth(db, path, data)
        if path == "/api/players":
            if data is None:
                accounts = self.account_list(db)
                current = self.account(db)
                setup = not db.execute("SELECT 1 FROM accounts WHERE parent=1").fetchone()
                return 200, accounts if setup or (current and current[2]) else [item for item in accounts if item["ready"]]
            return 403, {"error": "Создавайте игроков в родительском кабинете."}

        parts = path.split("/")
        if len(parts) != 4 or parts[1:3] != ["api", "players"]:
            return 404, {"error": "Страница не найдена."}
        player_id = parts[3]
        account = self.account(db)
        if not account:
            return 401, {"error": "Войдите в свой профиль."}
        if account[0] != player_id:
            return 403, {"error": "Этот прогресс принадлежит другому игроку."}
        row = db.execute("SELECT name,avatar,progress FROM players WHERE id=?", (player_id,)).fetchone()
        if row is None:
            return 404, {"error": "Игрок не найден."}
        name, avatar, saved = row
        profile = reward_defaults(json.loads(saved))
        if data is not None:
            self.update(db, player_id, profile, data)
            db.execute("UPDATE players SET progress=? WHERE id=?", (json.dumps(profile), player_id))
        return 200, player_view(player_id, name, avatar, profile, getattr(self, "character_rewards", False))

    @staticmethod
    def update(db, player_id, profile, data):
        kind = data.get("kind")
        if kind == "preference":
            key, value = data.get("key"), data.get("value")
            if not isinstance(key, str) or key not in PREFERENCES or not isinstance(value, str) or len(value) > 8000:
                raise ValueError("Некорректная настройка.")
            if key == "bunny-russian-class" and value not in [str(grade) for grade in school_classes(profile)]:
                raise ValueError("Этот класс не выбран для игрока.")
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
    initialize_database(options.database)
    allowed_hosts = {f"{host}:{options.port}" for host in ["127.0.0.1", "localhost", *options.host]}
    handler = partial(BunnyHandler, database=options.database, directory=options.directory, allowed_hosts=allowed_hosts)
    with ThreadingHTTPServer((options.bind, options.port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
