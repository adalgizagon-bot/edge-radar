"""Isolated empty test server: never reads or writes the user's market database."""

import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.app import main

with tempfile.TemporaryDirectory(prefix="edge-ui-") as directory:
    os.environ["EDGE_DB"] = str(Path(directory) / "test.sqlite3")
    sys.argv = ["server.app", "--port", "8091", "--no-collector"]
    main()
