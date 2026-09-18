#!/usr/bin/env python3
"""Build the VinHack SQLite database.

    py db/setup.py              # schema only (keeps an existing db)
    py db/setup.py --seed       # schema + dev seed data + rollup
    py db/setup.py --reset      # delete the db file first, then rebuild
    py db/setup.py --rollup     # just recompute daily_metrics

The database file is db/vinhack.db unless $VINHACK_DB says otherwise.
Application code should not import from here - use vinhack.db.connect().
"""
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vinhack.db import DB_PATH, connect, run_script, schema_exists  # noqa: E402

TABLES = ("students", "sleep_logs", "screen_time", "academic_tasks",
          "calendar_events", "mood_energy", "study_sessions", "daily_metrics")


def main() -> int:
    args = set(sys.argv[1:])

    if "--reset" in args and DB_PATH.exists():
        print(f"==> removing {DB_PATH.name}")
        sqlite3.connect(DB_PATH).close()
        DB_PATH.unlink()
        for suffix in ("-wal", "-shm"):
            sidecar = DB_PATH.with_name(DB_PATH.name + suffix)
            if sidecar.exists():
                sidecar.unlink()

    conn = connect()
    try:
        if "--rollup" in args:
            print("==> rollup.sql")
            run_script(conn, "rollup.sql")
        else:
            if schema_exists(conn):
                print("==> schema already present, skipping schema.sql")
            else:
                print("==> schema.sql")
                run_script(conn, "schema.sql")

            if "--seed" in args:
                print("==> seed_dev.sql")
                run_script(conn, "seed_dev.sql")
                print("==> rollup.sql")
                run_script(conn, "rollup.sql")

        print()
        for table in TABLES:
            n = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            print(f"  {table:<16} {n:>5} rows")
        print(f"\n{DB_PATH}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
