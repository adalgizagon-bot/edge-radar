import contextlib
import copy
import json
import os
import sqlite3
import time
from pathlib import Path
from .config import DEFAULTS, validate

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tokens(mint TEXT PRIMARY KEY,name TEXT NOT NULL,symbol TEXT NOT NULL,first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,pool_created INTEGER,active INTEGER NOT NULL DEFAULT 1,inactive_reason TEXT,source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshots(id INTEGER PRIMARY KEY,mint TEXT NOT NULL REFERENCES tokens(mint),observed_at INTEGER NOT NULL,source TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(mint,observed_at,source));
CREATE INDEX IF NOT EXISTS snapshot_history ON snapshots(mint,observed_at DESC);
CREATE TABLE IF NOT EXISTS assessments(id INTEGER PRIMARY KEY,mint TEXT NOT NULL REFERENCES tokens(mint),observed_at INTEGER NOT NULL,config_version INTEGER NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS assessment_history ON assessments(mint,observed_at DESC);
CREATE TABLE IF NOT EXISTS security(mint TEXT PRIMARY KEY,observed_at INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS social(id TEXT NOT NULL,mint TEXT NOT NULL,observed_at INTEGER NOT NULL,published_at INTEGER NOT NULL,author TEXT NOT NULL,text TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(id,mint));
CREATE INDEX IF NOT EXISTS social_mint_time ON social(mint,published_at);
CREATE TABLE IF NOT EXISTS social_checks(mint TEXT PRIMARY KEY,observed_at INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_state(name TEXT PRIMARY KEY,status TEXT NOT NULL,last_attempt INTEGER,last_success INTEGER,next_attempt INTEGER DEFAULT 0,failures INTEGER DEFAULT 0,requests INTEGER DEFAULT 0,error TEXT,cache_until INTEGER DEFAULT 0,cache TEXT);
CREATE TABLE IF NOT EXISTS jobs(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS job_runs(id INTEGER PRIMARY KEY,started_at INTEGER NOT NULL,finished_at INTEGER,status TEXT NOT NULL,data TEXT);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trades(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,strategy TEXT NOT NULL,category TEXT NOT NULL,regime TEXT NOT NULL,opened_at INTEGER NOT NULL,closed_at INTEGER,status TEXT NOT NULL,input_usd REAL NOT NULL,token_amount TEXT NOT NULL,entry_cost REAL NOT NULL,exit_value REAL,pnl REAL,entry_quote TEXT NOT NULL,exit_quote TEXT,policy TEXT NOT NULL,reason TEXT,peak REAL,fees REAL NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_per_mint ON trades(mint) WHERE status IN ('open','exit_unavailable');
CREATE TABLE IF NOT EXISTS trade_events(id INTEGER PRIMARY KEY,trade_id INTEGER NOT NULL,observed_at INTEGER NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
"""


def connect(path=None):
    path = path or os.environ.get("EDGE_DB", ".runtime/edge.sqlite3")
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=20, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    db.execute("INSERT OR IGNORE INTO schema_versions VALUES(1,?)", (now(),))
    if sum(bool(r["pk"]) for r in db.execute("PRAGMA table_info(social)")) == 1:
        # Forward-only migration preserving all existing social observations.
        with transaction(db):
            db.execute("ALTER TABLE social RENAME TO social_v1")
            db.execute(
                "CREATE TABLE social(id TEXT NOT NULL,mint TEXT NOT NULL,observed_at INTEGER NOT NULL,published_at INTEGER NOT NULL,author TEXT NOT NULL,text TEXT NOT NULL,source TEXT NOT NULL,PRIMARY KEY(id,mint))"
            )
            db.execute("INSERT INTO social SELECT * FROM social_v1")
            db.execute("DROP TABLE social_v1")
            db.execute(
                "CREATE INDEX IF NOT EXISTS social_mint_time ON social(mint,published_at)"
            )
    db.execute("INSERT OR IGNORE INTO schema_versions VALUES(2,?)", (now(),))
    db.execute("INSERT OR IGNORE INTO settings VALUES(1,1,?)", (dump(DEFAULTS),))
    row = db.execute("SELECT data FROM settings WHERE id=1").fetchone()
    current = load(row["data"])
    merged = {**copy.deepcopy(DEFAULTS), **current}
    if merged != current:
        db.execute(
            "UPDATE settings SET data=?,revision=revision+1 WHERE id=1", (dump(merged),)
        )
    return db


def now():
    return int(time.time())


def dump(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def load(value):
    return json.loads(value) if value else None


@contextlib.contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.execute("COMMIT")
    except BaseException:
        db.execute("ROLLBACK")
        raise


def settings(db):
    row = db.execute("SELECT * FROM settings WHERE id=1").fetchone()
    return load(row["data"]), row["revision"]


def save_settings(db, value, expected):
    value = validate(value)
    with transaction(db):
        config, revision = settings(db)
        if expected != revision:
            raise ValueError("Configuração alterada por outra sessão; recarregue")
        if (
            db.execute("SELECT count(*) FROM trades").fetchone()[0]
            and value["paper_initial_usd"] != config["paper_initial_usd"]
        ):
            raise ValueError("Capital inicial fica fixo após a primeira operação")
        db.execute(
            "UPDATE settings SET revision=revision+1,data=? WHERE id=1", (dump(value),)
        )
    return revision + 1


def ingest(db, observations, at):
    with transaction(db):
        for x in observations:
            x = copy.deepcopy(x)
            mint = x["mint"]
            source = x["source"]
            created = x.get("pool_created")
            observed = x.get("observed_at", at)
            if observed > at:
                raise ValueError("Observação futura não pode ser persistida")
            db.execute(
                """INSERT INTO tokens(mint,name,symbol,first_seen,last_seen,pool_created,source) VALUES(?,?,?,?,?,?,?)
             ON CONFLICT(mint) DO UPDATE SET name=excluded.name,symbol=excluded.symbol,last_seen=MAX(tokens.last_seen,excluded.last_seen),pool_created=COALESCE(MIN(tokens.pool_created,excluded.pool_created),tokens.pool_created,excluded.pool_created),active=1,inactive_reason=NULL""",
                (
                    mint,
                    x.get("name") or mint[:8],
                    x.get("symbol") or "?",
                    at,
                    observed,
                    created,
                    source,
                ),
            )
            db.execute(
                "INSERT OR IGNORE INTO snapshots(mint,observed_at,source,data) VALUES(?,?,?,?)",
                (mint, observed, source, dump(x)),
            )


def history(db, mint, limit=2000):
    rows = db.execute(
        "SELECT observed_at,data FROM snapshots WHERE mint=? ORDER BY observed_at DESC,id DESC LIMIT ?",
        (mint, limit),
    ).fetchall()
    return [dict(load(r["data"]), observed_at=r["observed_at"]) for r in reversed(rows)]


def acquire(db, owner, at, ttl=300):
    with transaction(db):
        db.execute("DELETE FROM jobs WHERE expires<=?", (at,))
        try:
            db.execute("INSERT INTO jobs VALUES(?,?,?)", ("collect", owner, at + ttl))
        except sqlite3.IntegrityError:
            return False
    return True
