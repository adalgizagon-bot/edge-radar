"""Import a staging D1 SQLite export into a NEW local analysis database only.

No network, production migrations, fabricated samples, or retrospective alerts.
"""

import argparse
import sqlite3
from pathlib import Path
from server.db import connect, ingest, load, now
from server.tracking import initialize


def import_export(source, target):
    if Path(target).exists() or Path(source).resolve() == Path(target).resolve():
        raise ValueError(
            "Destination must be a new database; back up and merge deliberately"
        )
    src = sqlite3.connect(f"file:{Path(source).resolve()}?mode=ro", uri=True)
    db = connect(target)
    total = 0
    try:
        for (data,) in src.execute(
            "SELECT data FROM observations ORDER BY observed_at,id"
        ):
            x = load(data)
            if not x.get("observed_at") or x["observed_at"] > now():
                raise ValueError("Missing or future observation timestamp")
            ingest(db, [x], x["observed_at"])
            total += 1
        initialize(db)
    finally:
        db.close()
        src.close()
    return total


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source")
    p.add_argument("new_target")
    args = p.parse_args()
    print(
        {
            "imported": import_export(args.source, args.new_target),
            "signals": 0,
            "note": "No retroactive alerts generated",
        }
    )
