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
