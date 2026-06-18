# car-sim persistence — SQLite (WAL). Holds user accounts + the trip-log spine (trips/events)
# the accounts/admin/replay layer is built on. One file under a docker named volume so it survives
# redeploys (the image's data/cities/ is rebuilt each deploy, so the DB must live elsewhere).
#
# Connections are opened per call (SQLite is cheap to open; WAL gives concurrent readers + 1 writer),
# which sidesteps sqlite3's per-connection thread affinity under FastAPI's sync-endpoint threadpool.

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

_DEFAULT = Path(__file__).resolve().parent.parent / "var" / "app.db"
DB_PATH = Path(os.environ.get("CARSIM_DB", _DEFAULT))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT UNIQUE NOT NULL,
  pw_hash       TEXT,                              -- NULL for OAuth-only accounts
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'admin'
  provider      TEXT NOT NULL DEFAULT 'password',  -- 'password' | 'google'
  locale        TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT,
  disabled      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trips (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city         TEXT,
  district     TEXT,
  started_at   TEXT,
  ended_at     TEXT,
  distance_m   REAL DEFAULT 0,
  duration_s   REAL DEFAULT 0,
  n_violations INTEGER DEFAULT 0,
  samples_json TEXT,                               -- compact downsampled vehicle states (replay)
  summary_json TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  t_ms    INTEGER,
  kind    TEXT,                                    -- over_limit|wrong_way|ran_red|stop|off_road|boundary
  x       REAL, y REAL, meta TEXT
);
CREATE TABLE IF NOT EXISTS map_objects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city        TEXT NOT NULL,                          -- city slug (praha/brno/…) the object belongs to
  name        TEXT NOT NULL,
  description TEXT,
  kind        TEXT,                                    -- standard-icon key (station/museum/…); '' for a custom icon
  icon        TEXT,                                    -- custom-icon URL path (/uploads/…) or NULL when using `kind`
  lat         REAL NOT NULL, lon REAL NOT NULL,        -- geolocation (what the admin enters)
  x           REAL NOT NULL, y   REAL NOT NULL,        -- projected world metres for `city` (computed at save time)
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain     TEXT NOT NULL,                          -- 'quiz' | 'situation'
  topic      TEXT,                                   -- quiz type or situation rule (for the per-topic breakdown)
  correct    INTEGER NOT NULL DEFAULT 0,             -- 0/1
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_user ON trips(user_id);
CREATE INDEX IF NOT EXISTS idx_events_trip ON events(trip_id);
CREATE INDEX IF NOT EXISTS idx_objects_city ON map_objects(city);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH), timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    c.execute("PRAGMA busy_timeout=5000")
    return c


@contextmanager
def conn():
    c = _connect()
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init_db() -> None:
    with conn() as c:
        c.executescript(SCHEMA)


# ---- user queries -------------------------------------------------------------

def _row_to_user(r: sqlite3.Row | None) -> dict | None:
    return dict(r) if r is not None else None


def get_user(uid: int) -> dict | None:
    with conn() as c:
        return _row_to_user(c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())


def get_user_by_email(email: str) -> dict | None:
    with conn() as c:
        return _row_to_user(c.execute("SELECT * FROM users WHERE email=?", (email.lower(),)).fetchone())


def create_user(email: str, *, pw_hash: str | None = None, display_name: str | None = None,
                role: str = "user", provider: str = "password", locale: str | None = None) -> dict:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO users (email, pw_hash, display_name, role, provider, locale, created_at, last_login_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (email.lower(), pw_hash, display_name or email.split("@")[0], role, provider, locale,
             now_iso(), now_iso()),
        )
        # read back on the SAME connection — a separate connection can't see the row until this
        # transaction commits (WAL isolation), which would return None.
        return dict(c.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone())


def touch_login(uid: int) -> None:
    with conn() as c:
        c.execute("UPDATE users SET last_login_at=? WHERE id=?", (now_iso(), uid))


def set_role(uid: int, role: str) -> None:
    with conn() as c:
        c.execute("UPDATE users SET role=? WHERE id=?", (role, uid))


def set_disabled(uid: int, disabled: bool) -> None:
    with conn() as c:
        c.execute("UPDATE users SET disabled=? WHERE id=?", (1 if disabled else 0, uid))


def set_password(uid: int, pw_hash: str) -> None:
    with conn() as c:
        c.execute("UPDATE users SET pw_hash=? WHERE id=?", (pw_hash, uid))


def delete_user(uid: int) -> None:
    with conn() as c:
        c.execute("DELETE FROM users WHERE id=?", (uid,))   # cascades trips/events (foreign_keys ON)


def list_users(limit: int = 500, q: str | None = None) -> list[dict]:
    sql = "SELECT u.*, (SELECT COUNT(*) FROM trips t WHERE t.user_id=u.id) AS n_trips FROM users u"
    args: tuple = ()
    if q:
        sql += " WHERE u.email LIKE ? OR u.display_name LIKE ?"
        args = (f"%{q}%", f"%{q}%")
    sql += " ORDER BY u.created_at DESC LIMIT ?"
    args += (limit,)
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def count_users() -> int:
    with conn() as c:
        return c.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]


# ---- trip queries (used from Phase 2; defined now so the schema/model is one piece) ----

def create_trip(user_id: int, **f) -> int:
    cols = ["user_id", "city", "district", "started_at", "ended_at", "distance_m",
            "duration_s", "n_violations", "samples_json", "summary_json"]
    vals = [user_id] + [f.get(k) for k in cols[1:]]
    with conn() as c:
        cur = c.execute(f"INSERT INTO trips ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals)
        return cur.lastrowid


def add_events(trip_id: int, events: list[dict]) -> None:
    if not events:
        return
    with conn() as c:
        c.executemany(
            "INSERT INTO events (trip_id, t_ms, kind, x, y, meta) VALUES (?,?,?,?,?,?)",
            [(trip_id, e.get("t_ms"), e.get("kind"), e.get("x"), e.get("y"), e.get("meta")) for e in events],
        )


def list_trips(user_id: int, limit: int = 200) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT id, city, district, started_at, ended_at, distance_m, duration_s, n_violations "
            "FROM trips WHERE user_id=? ORDER BY started_at DESC LIMIT ?", (user_id, limit)).fetchall()]


def get_trip(trip_id: int) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM trips WHERE id=?", (trip_id,)).fetchone()
        return dict(r) if r else None


def trip_events(trip_id: int) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT t_ms, kind, x, y, meta FROM events WHERE trip_id=? ORDER BY t_ms", (trip_id,)).fetchall()]


# ---- map objects (msg 2983 ph3): admin-placed icons/landmarks rendered on /drive ----

_OBJ_COLS = ("id", "city", "name", "description", "kind", "icon", "lat", "lon", "x", "y",
             "created_by", "created_at")


def list_objects(city: str | None = None) -> list[dict]:
    sql = "SELECT * FROM map_objects"
    args: tuple = ()
    if city:
        sql += " WHERE city=?"
        args = (city,)
    sql += " ORDER BY name COLLATE NOCASE"
    with conn() as c:
        return [dict(r) for r in c.execute(sql, args).fetchall()]


def get_object(oid: int) -> dict | None:
    with conn() as c:
        r = c.execute("SELECT * FROM map_objects WHERE id=?", (oid,)).fetchone()
        return dict(r) if r else None


def create_object(*, city: str, name: str, description: str | None, kind: str | None,
                  icon: str | None, lat: float, lon: float, x: float, y: float,
                  created_by: int | None) -> dict:
    with conn() as c:
        cur = c.execute(
            "INSERT INTO map_objects (city, name, description, kind, icon, lat, lon, x, y, "
            "created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (city, name, description, kind, icon, lat, lon, x, y, created_by, now_iso()),
        )
        return dict(c.execute("SELECT * FROM map_objects WHERE id=?", (cur.lastrowid,)).fetchone())


def delete_object(oid: int) -> None:
    with conn() as c:
        c.execute("DELETE FROM map_objects WHERE id=?", (oid,))


# ---- quiz / situation attempts (accounts Phase 2 stats — msg 3128) ----

def record_attempt(user_id: int, domain: str, topic: str | None, correct: bool) -> None:
    with conn() as c:
        c.execute(
            "INSERT INTO attempts (user_id, domain, topic, correct, created_at) VALUES (?,?,?,?,?)",
            (user_id, domain, (topic or "")[:64], 1 if correct else 0, now_iso()),
        )


def attempt_stats(user_id: int) -> dict:
    """Per-domain totals + a per-topic breakdown: {'quiz': {n, ok, by_topic:[…]}, 'situation': {…}}."""
    with conn() as c:
        rows = c.execute(
            "SELECT domain, topic, COUNT(*) AS n, COALESCE(SUM(correct),0) AS ok "
            "FROM attempts WHERE user_id=? GROUP BY domain, topic", (user_id,)).fetchall()
    out: dict = {}
    for r in rows:
        d = out.setdefault(r["domain"], {"n": 0, "ok": 0, "by_topic": []})
        d["n"] += r["n"]
        d["ok"] += r["ok"]
        if r["topic"]:
            d["by_topic"].append({"topic": r["topic"], "n": r["n"], "ok": r["ok"]})
    for d in out.values():
        d["by_topic"].sort(key=lambda x: -x["n"])
    return out


def list_attempts(user_id: int, limit: int = 100000) -> list[dict]:
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT domain, topic, correct, created_at FROM attempts WHERE user_id=? "
            "ORDER BY created_at DESC LIMIT ?", (user_id, limit)).fetchall()]


def export_user(uid: int) -> dict:
    """All of a user's data (GDPR export)."""
    u = get_user(uid)
    trips = list_trips(uid, limit=100000)
    for t in trips:
        t["events"] = trip_events(t["id"])
    return {"user": u, "trips": trips, "attempts": list_attempts(uid)}
