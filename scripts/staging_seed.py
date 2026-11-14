"""Generate idempotent SQL from a validation backup. Never connects to Cloudflare."""

import argparse
from pathlib import Path
import sqlite3
from server.sources import MINT


def generate(source, target):
    src = sqlite3.connect(f"file:{Path(source).resolve()}?mode=ro", uri=True)
    try:
        tokens = src.execute(
            "SELECT mint,first_seen FROM tokens ORDER BY mint"
        ).fetchall()
        snapshots = src.execute(
            "SELECT mint,observed_at,source,data FROM snapshots ORDER BY observed_at,id"
        ).fetchall()
    finally:
        src.close()
    if any(not MINT.fullmatch(r[0]) for r in tokens):
        raise ValueError("Invalid contract in backup")

    def literal(x):
        return str(x) if isinstance(x, int) else "'" + str(x).replace("'", "''") + "'"

    lines = [
        "-- STAGING ONLY. Generated from the validation archive; no historical alerts are created."
    ]
    for mint, first in tokens:
        lines.append(
            "INSERT OR IGNORE INTO catalog(mint,first_seen,last_seen,next_at) VALUES("
            + ",".join([literal(mint), literal(first), "0", "0"])
            + ");"
        )
    for row in snapshots:
        lines.append(
            "INSERT OR IGNORE INTO observations(mint,observed_at,source,data) VALUES("
            + ",".join(map(literal, row))
            + ");"
        )
    lines.append(
        "UPDATE monitor_state SET samples_reserved=MAX(samples_reserved,(SELECT count(*) FROM observations)) WHERE id=1 AND purpose='edge-radar-staging';"
    )
    with Path(target).open("x") as f:
        f.write("\n".join(lines) + "\n")
    return {
        "contracts": len(tokens),
        "snapshots": len(snapshots),
        "remote_operations": 0,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source_backup")
    p.add_argument("new_sql_file")
    a = p.parse_args()
    print(generate(a.source_backup, a.new_sql_file))
