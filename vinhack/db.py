"""Database access for VinHack.

Every connection to the database must come from here. SQLite disables
foreign keys by default and the setting is per-connection, so a plain
sqlite3.connect() would silently ignore every cascade in the schema.
"""
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parent.parent
SQL_DIR = ROOT / "db"
DB_PATH = Path(os.environ.get("VINHACK_DB", SQL_DIR / "vinhack.db"))


def connect(path: Path | None = None) -> sqlite3.Connection:
    """Open a connection with the pragmas VinHack expects."""
    conn = sqlite3.connect(path or DB_PATH, check_same_thread=False)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.row_factory = sqlite3.Row
    return conn


def get_conn() -> Iterator[sqlite3.Connection]:
    """FastAPI dependency: one connection per request, always closed."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def run_script(conn: sqlite3.Connection, name: str) -> None:
    """Execute one of the .sql files in db/."""
    conn.executescript((SQL_DIR / name).read_text(encoding="utf-8"))
    conn.commit()


def rows(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]


def one(cur: sqlite3.Cursor) -> dict[str, Any] | None:
    r = cur.fetchone()
    return dict(r) if r else None


def schema_exists(conn: sqlite3.Connection) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='students'"
    ).fetchone())


def insert(conn: sqlite3.Connection, table: str, data: dict[str, Any], pk: str) -> dict[str, Any]:
    """Insert a row and return it as stored, including any trigger-derived values."""
    data = {k: v for k, v in data.items() if v is not None}
    cols = ", ".join(data)
    marks = ", ".join("?" for _ in data)
    cur = conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(data.values()))
    conn.commit()
    return one(conn.execute(f"SELECT * FROM {table} WHERE {pk} = ?", (cur.lastrowid,)))


def update(conn: sqlite3.Connection, table: str, data: dict[str, Any],
           pk: str, pk_value: int) -> dict[str, Any] | None:
    """Apply a partial update and return the row as stored."""
    if data:
        sets = ", ".join(f"{k} = ?" for k in data)
        conn.execute(f"UPDATE {table} SET {sets} WHERE {pk} = ?",
                     [*data.values(), pk_value])
        conn.commit()
    return one(conn.execute(f"SELECT * FROM {table} WHERE {pk} = ?", (pk_value,)))


# Columns added after the first release. CREATE TABLE IF NOT EXISTS cannot add
# a column to a table that already exists, so anything introduced later has to
# be listed here as well as in schema.sql.
LATER_COLUMNS = {
    "students": [
        ("programme", "TEXT"),
        ("registration_no", "TEXT"),
        ("sleep_goal_minutes", "INTEGER NOT NULL DEFAULT 480"),
        ("daily_study_goal_hours", "REAL NOT NULL DEFAULT 4.0"),
    ],
}


def add_missing_columns(conn: sqlite3.Connection) -> list[str]:
    """Bring an existing database up to the current column list.

    Idempotent: it reads what is actually there and adds only the gap, so it
    is safe to run on every startup. Returns what it added, for logging.

    SQLite's ALTER TABLE ADD COLUMN cannot add a CHECK constraint, so the
    bounds on the goal columns live in schema.sql for fresh databases and are
    enforced by the API's own validation for migrated ones.
    """
    added = []
    for table, columns in LATER_COLUMNS.items():
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone():
            continue
        have = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, decl in columns:
            if name in have:
                continue
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
            added.append(f"{table}.{name}")
    if added:
        conn.commit()
    return added
