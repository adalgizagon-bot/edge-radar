"""Consistent online backup; never replaces an existing backup."""

import os
import sqlite3
import sys
from pathlib import Path

source = Path(os.environ.get("EDGE_DB", ".runtime/edge.sqlite3")).resolve()
if len(sys.argv) != 2:
    raise SystemExit("Uso: python3 scripts/backup_db.py NOVO_ARQUIVO.sqlite3")
target = Path(sys.argv[1]).resolve()
if not source.is_file() or target.exists() or target == source:
    raise SystemExit("Origem ausente ou destino já existe; nenhuma alteração feita")
target.parent.mkdir(parents=True, exist_ok=True)
# Exclusive creation avoids accidentally overwriting a concurrent backup.
fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
os.close(fd)
with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as src:
    with sqlite3.connect(target) as dst:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("Backup não passou na verificação de integridade")
print("Backup íntegro:", target)
