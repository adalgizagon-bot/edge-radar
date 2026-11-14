"""Fail closed rather than silently starting a new empty history after a remount."""

import os
from pathlib import Path
from server.db import connect, settings
from server.collector import main


def validate_database(path):
    if not path or not Path(path).is_absolute() or not Path(path).is_file():
        raise ValueError(
            "EDGE_DB must point to an existing absolute persistent database path"
        )
    db = connect(path)
    try:
        if settings(db)[0]["paper_auto"]:
            raise ValueError(
                "Disable paper_auto before running the monitoring-only service"
            )
    finally:
        db.close()


if __name__ == "__main__":
    validate_database(os.environ.get("EDGE_DB"))
    raise SystemExit(main())
