#!/usr/bin/env python3
"""Build the VinHack SQLite database.

    py setup.py              # schema only (keeps an existing db)
    py setup.py --seed       # schema + dev seed data + rollup
    py setup.py --reset      # delete the db file first, then rebuild
    py setup.py --rollup     # just recompute daily_metrics

The database file is db/vinhack.db unless $VINHACK_DB says otherwise.
"""
import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).parent
DB_PATH = Path(os.environ.get("VINHACK_DB", HERE / "vinhack.db"))


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    """Open a connection with the pragmas VinHack expects.

    foreign_keys is off by default in SQLite and is per-connection, so every
    part of the app must set it or the cascades silently do nothing.
    """
    conn = sqlite3.connect(path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.row_factory = sqlite3.Row
    return conn


def run_script(conn: sqlite3.Connection, name: str) -> None:
    print(f"==> {name}")
    conn.executescript((HERE / name).read_text(encoding="utf-8"))
    conn.commit()


def main() -> int:
    args = set(sys.argv[1:])

    if "--reset" in args and DB_PATH.exists():
        print(f"==> removing {DB_PATH.name}")
        conn = sqlite3.connect(DB_PATH)
        conn.close()
        DB_PATH.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = DB_PATH.with_name(DB_PATH.name + suffix)
            if sidecar.exists():
                sidecar.unlink()

    conn = connect()
    try:
        if "--rollup" in args:
            run_script(conn, "rollup.sql")
        else:
            existing = conn.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='students'"
            ).fetchone()[0]
            if existing:
                print("==> schema already present, skipping schema.sql")
            else:
                run_script(conn, "schema.sql")

            if "--seed" in args:
                run_script(conn, "seed_dev.sql")
                run_script(conn, "rollup.sql")

        print()
        for table in ("students", "sleep_logs", "screen_time", "academic_tasks",
                      "calendar_events", "mood_energy", "study_sessions",
                      "daily_metrics"):
            n = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            print(f"  {table:<16} {n:>5} rows")
        print(f"\n{DB_PATH}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
