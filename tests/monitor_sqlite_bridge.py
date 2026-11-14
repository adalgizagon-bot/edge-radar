"""SQLite-backed D1 test adapter; never contacts Cloudflare."""

import json
import sqlite3
import sys

payload = json.load(sys.stdin)
db = sqlite3.connect(payload["path"])
db.row_factory = sqlite3.Row
try:
    results = []
    for item in payload["statements"]:
        c = db.execute(item["sql"], item.get("args", []))
        rows = [dict(r) for r in c.fetchall()] if c.description else []
        results.append({"results": rows, "meta": {"changes": max(0, c.rowcount)}})
    db.commit()
    print(json.dumps(results))
except BaseException:
    db.rollback()
    raise
finally:
    db.close()
