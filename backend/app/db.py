import os
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("ZHOL_DB", BACKEND_DIR / "zhol.db"))
UPLOAD_DIR = Path(os.environ.get("ZHOL_UPLOADS", BACKEND_DIR / "uploads"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    company     TEXT NOT NULL,
    bin         TEXT,
    role        TEXT NOT NULL,
    pw_hash     TEXT NOT NULL,
    is_demo     INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS shipments (
    id          INTEGER PRIMARY KEY,
    number      TEXT NOT NULL UNIQUE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  REAL NOT NULL,
    form        TEXT NOT NULL,
    cost        TEXT,
    route_id    TEXT NOT NULL,
    started     INTEGER NOT NULL DEFAULT 0,
    delivered   INTEGER NOT NULL DEFAULT 0,
    t           REAL NOT NULL DEFAULT 0,
    cursor      INTEGER NOT NULL DEFAULT 0,
    hold_cursor INTEGER NOT NULL DEFAULT -1,
    last_tick   REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS participants (
    shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    joined_at   REAL NOT NULL,
    PRIMARY KEY (shipment_id, role)
);
CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY,
    shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    doc_type    TEXT NOT NULL,
    filename    TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size        INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_role TEXT NOT NULL,
    uploaded_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS declarations (
    id           INTEGER PRIMARY KEY,
    number       TEXT NOT NULL UNIQUE,
    shipment_id  INTEGER NOT NULL UNIQUE REFERENCES shipments(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    payload      TEXT NOT NULL,
    hash         TEXT NOT NULL,
    submitted_by INTEGER NOT NULL REFERENCES users(id),
    submitted_at REAL NOT NULL,
    decided_by   INTEGER REFERENCES users(id),
    decided_at   REAL,
    comment      TEXT
);
CREATE TABLE IF NOT EXISTS ledger (
    idx        INTEGER PRIMARY KEY,
    ts         INTEGER NOT NULL,
    shipment   TEXT NOT NULL,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
);
"""

# Прототип работает с одним соединением SQLite. Запросы выполняются по очереди
# под блокировкой, поэтому записи реестра не могут «перехлестнуться».
# Lock (а не RLock), потому что FastAPI может войти в зависимость и выйти из неё в разных потоках.
_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA foreign_keys = ON")
        _conn.executescript(SCHEMA)
        _migrate(_conn)
    return _conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Добавляет колонки, появившиеся после создания базы, чтобы не терять данные."""
    columns = {r["name"] for r in conn.execute("PRAGMA table_info(shipments)")}
    if "cost" not in columns:
        conn.execute("ALTER TABLE shipments ADD COLUMN cost TEXT")
        conn.commit()


@contextmanager
def transaction():
    conn = connection()
    with _lock:
        try:
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise


def get_db():
    """Зависимость FastAPI: одна транзакция на запрос."""
    with transaction() as conn:
        yield conn
