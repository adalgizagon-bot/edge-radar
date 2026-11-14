"""Restore an archived snapshot only to a new path, verifying archive and SQLite."""

import argparse
import gzip
import hashlib
import os
from pathlib import Path
import sqlite3


def restore(source, target, expected_sha256):
    source, target = Path(source), Path(target)
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError("Archive SHA-256 mismatch")
    target.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        size = 0
        with os.fdopen(fd, "wb") as dst, gzip.open(source, "rb") as src:
            while chunk := src.read(1024 * 1024):
                size += len(chunk)
                if size > 1024 * 1024 * 1024:
                    raise ValueError("Archive exceeds 1 GB safety limit")
                dst.write(chunk)
        with sqlite3.connect(f"file:{target.resolve()}?mode=ro", uri=True) as db:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Invalid SQLite archive")
            db.execute("SELECT count(*) FROM snapshots").fetchone()
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return str(target.resolve())


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("archive")
    p.add_argument("new_target")
    p.add_argument("--sha256", required=True)
    args = p.parse_args()
    print(restore(args.archive, args.new_target, args.sha256))
