"""Persistent sampling queue and forward-only, observational signal evaluation."""

from .db import dump, history

SCHEMA = """
CREATE TABLE IF NOT EXISTS security_attempts(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,observed_at INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(mint,observed_at,data));
CREATE TABLE IF NOT EXISTS tracking(mint TEXT PRIMARY KEY REFERENCES tokens(mint),priority REAL NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,last_attempt INTEGER,last_success INTEGER,misses INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT 'rotation');
CREATE INDEX IF NOT EXISTS tracking_due ON tracking(next_at,priority DESC);
CREATE TABLE IF NOT EXISTS sampling_gaps(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,reason TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS open_sampling_gap ON sampling_gaps(mint) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS signals(id INTEGER PRIMARY KEY,mint TEXT NOT NULL,kind TEXT NOT NULL,observed_at INTEGER NOT NULL,price_observed_at INTEGER NOT NULL,price REAL NOT NULL,source TEXT NOT NULL,pool TEXT NOT NULL,evidence TEXT NOT NULL,UNIQUE(mint,kind,observed_at));
CREATE INDEX IF NOT EXISTS signal_token_time ON signals(mint,observed_at);
CREATE TABLE IF NOT EXISTS signal_outcomes(signal_id INTEGER NOT NULL REFERENCES signals(id),horizon INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(signal_id,horizon));
"""


def initialize(db):
    db.executescript(SCHEMA)
    columns = {r["name"] for r in db.execute("PRAGMA table_info(tracking)")}
    for name, spec in {
        "tier": "TEXT NOT NULL DEFAULT 'follow'",
        "weak_streak": "INTEGER NOT NULL DEFAULT 0",
        "pin_until": "INTEGER NOT NULL DEFAULT 0",
        "classified_at": "INTEGER NOT NULL DEFAULT 0",
    }.items():
        if name not in columns:
            db.execute(f"ALTER TABLE tracking ADD COLUMN {name} {spec}")
    db.execute(
        "INSERT OR IGNORE INTO security_attempts(mint,observed_at,data) SELECT mint,observed_at,data FROM security"
    )
    db.execute(
        "INSERT OR IGNORE INTO tracking(mint,last_success) SELECT mint,last_seen FROM tokens"
    )


def due(db, at, limit=60):
    initialize(db)
    db.execute(
        "UPDATE tracking SET tier='follow',reason='stale' WHERE tier='fast' AND pin_until<=? AND COALESCE(last_success,0)<?",
        (at, at - 600),
    )
    # Pinned study arms have first claim; at most 12 contracts are admitted to fast.
    pinned = [
        r["mint"]
        for r in db.execute(
            "SELECT mint FROM tracking WHERE pin_until>? ORDER BY next_at,mint LIMIT ?",
            (at, min(12, limit)),
        )
    ]
    fast = [
        r["mint"]
        for r in db.execute(
            "SELECT mint FROM tracking WHERE tier='fast' AND next_at<=? ORDER BY priority DESC,next_at,mint LIMIT 12",
            (at,),
        )
        if r["mint"] not in pinned
    ]
    selected = (pinned + fast)[: min(12, limit)]
    follow = [
        r["mint"]
        for r in db.execute(
            "SELECT mint FROM tracking WHERE next_at<=? ORDER BY COALESCE(last_attempt,0),mint LIMIT ?",
            (at, limit),
        )
    ]
    return list(dict.fromkeys(selected + follow))[:limit]


def attempted(db, mints, rows, at, stale_seconds=600):
    observed = {}
    for x in rows:
        if x.get("price") is not None:
            observed[x["mint"]] = max(
                observed.get(x["mint"], 0), x.get("observed_at", at)
            )
    for mint in mints:
        success = observed.get(mint)
        state = db.execute("SELECT * FROM tracking WHERE mint=?", (mint,)).fetchone()
        if not state:
            continue
        fresh = (
            success is not None
            and at - success <= stale_seconds
            and (
                success > (state["last_success"] or 0) or state["last_attempt"] is None
            )
        )
        if fresh:
            if (
                state["last_success"]
                and success - state["last_success"] > stale_seconds
            ):
                db.execute(
                    "INSERT OR IGNORE INTO sampling_gaps(mint,started_at,reason) VALUES(?,?,'interval_without_sample')",
                    (mint, state["last_success"] + stale_seconds),
                )
            db.execute(
                "UPDATE sampling_gaps SET ended_at=? WHERE mint=? AND ended_at IS NULL",
                (success, mint),
            )
            db.execute(
                "UPDATE tracking SET last_attempt=?,last_success=?,misses=0,next_at=? WHERE mint=?",
                (at, success, at + 300, mint),
            )
        else:
            misses = state["misses"] + 1
            db.execute(
                "INSERT OR IGNORE INTO sampling_gaps(mint,started_at,reason) VALUES(?,?,'refresh_failed_or_no_new_price')",
                (mint, at),
            )
            db.execute(
                "UPDATE tracking SET last_attempt=?,misses=?,next_at=? WHERE mint=?",
                (at, misses, at + min(3600, 180 * 2 ** min(misses, 4)), mint),
            )


def record(db, mint, result, at):
    a = result["assessment"]
    x = result.get("latest") or {}
    fresh = x.get("price") is not None and 0 <= at - x.get("observed_at", 0) <= 600
    liquidity = x.get("liquidity")
    pressure = a.get("pressure")
    promising = (
        fresh
        and liquidity is not None
        and liquidity >= 20000
        and (x.get("volume5m") or 0) >= 2000
        and pressure is not None
        and pressure >= 0.6
        and not a["flags"]
    )
    previous = db.execute("SELECT * FROM tracking WHERE mint=?", (mint,)).fetchone()
    prior = next(
        (
            v
            for v in reversed(history(db, mint))
            if v.get("source") == x.get("source")
            and v.get("pool") == x.get("pool")
            and v["observed_at"] < x.get("observed_at", 0)
        ),
        None,
    )
    weakening = bool(
        prior
        and fresh
        and (
            not promising
            or x.get("volume5m") is not None
            and prior.get("volume5m")
            and x["volume5m"] < prior["volume5m"] * 0.7
            or pressure is not None
            and pressure < 0.5
            or x.get("liquidity") is not None
            and prior.get("liquidity")
            and x["liquidity"] < prior["liquidity"] * 0.9
        )
    )
    new_sample = not previous or x.get("observed_at", 0) > previous["classified_at"]
    weak = (
        (previous["weak_streak"] + 1 if previous and weakening else 0)
        if new_sample
        else (previous["weak_streak"] if previous else 0)
    )
    detected = any(a["radars"][k]["detected"] for k in ["acceleration", "revival"])
    priority = 100 if detected else 60 if promising else 10
    reason = (
        "signal"
        if detected
        else "promising"
        if promising
        else "weakening"
        if weakening
        else "rotation"
    )
    pinned = bool(previous and previous["pin_until"] > at)
    stale = not fresh
    was_fast = bool(previous and previous["tier"] == "fast")
    tier = (
        "fast"
        if pinned
        or fresh
        and not a["flags"]
        and weak < 2
        and (detected or promising or was_fast and weak < 2)
        else "follow"
    )
    others = db.execute(
        "SELECT count(*) FROM tracking WHERE tier='fast' AND mint!=?", (mint,)
    ).fetchone()[0]
    if tier == "fast" and not pinned and others >= 12:
        tier = "follow"
        reason = "fast_capacity_full"
    if stale:
        reason = "stale"
    interval = 180 if tier == "fast" else 1800
    db.execute("INSERT OR IGNORE INTO tracking(mint) VALUES(?)", (mint,))
    db.execute(
        "UPDATE tracking SET priority=?,reason=?,tier=?,weak_streak=?,classified_at=MAX(classified_at,?),next_at=CASE WHEN misses=0 THEN ? ELSE next_at END WHERE mint=?",
        (priority, reason, tier, weak, x.get("observed_at", 0), at + interval, mint),
    )
    if not fresh or not x.get("pool") or x["price"] <= 0:
        return
    for kind in ["acceleration", "revival"]:
        if not a["radars"][kind]["detected"]:
            continue
        previous = db.execute(
            "SELECT observed_at FROM signals WHERE mint=? AND kind=? ORDER BY observed_at DESC LIMIT 1",
            (mint, kind),
        ).fetchone()
        if previous and at - previous["observed_at"] < 3600:
            continue
        db.execute(
            "INSERT OR IGNORE INTO signals(mint,kind,observed_at,price_observed_at,price,source,pool,evidence) VALUES(?,?,?,?,?,?,?,?)",
            (
                mint,
                kind,
                at,
                x["observed_at"],
                x["price"],
                x["source"],
                x["pool"],
                dump(a),
            ),
        )


def outcomes(db, at):
    # Bounded work; oldest unfinished signals retain priority. Never substitute another pool.
    signals = db.execute(
        "SELECT * FROM signals WHERE id NOT IN (SELECT signal_id FROM signal_outcomes WHERE status!='pending' GROUP BY signal_id HAVING count(*)=4) ORDER BY observed_at LIMIT 200"
    ).fetchall()
    for s in signals:
        h = [
            x
            for x in history(db, s["mint"])
            if s["observed_at"] < x["observed_at"] <= at
            and x.get("source") == s["source"]
            and x.get("pool") == s["pool"]
            and x.get("price") is not None
            and x["price"] > 0
        ]
        for minutes in [5, 15, 30, 60]:
            old = db.execute(
                "SELECT status FROM signal_outcomes WHERE signal_id=? AND horizon=?",
                (s["id"], minutes),
            ).fetchone()
            if old and old["status"] != "pending":
                continue
            target = s["observed_at"] + minutes * 60
            end = next(
                (x for x in h if target <= x["observed_at"] <= target + 180), None
            )
            window = [x for x in h if x["observed_at"] <= target]
            status = (
                "observed" if end else "missing" if at > target + 180 else "pending"
            )
            prices = [s["price"]] + [x["price"] for x in window]
            times = [s["observed_at"]] + [x["observed_at"] for x in window]
            data = {
                "target_at": target,
                "sample_at": end["observed_at"] if end else None,
                "price": end["price"] if end else None,
                "change_pct": (end["price"] / s["price"] - 1) * 100 if end else None,
                "sampled_max_gain_pct": (max(prices) / s["price"] - 1) * 100,
                "sampled_max_drawdown_pct": (min(prices) / s["price"] - 1) * 100,
                "samples": len(window),
                "max_gap_seconds": max(
                    [b - a for a, b in zip(times, times[1:])]
                    + [max(0, min(at, target) - times[-1])]
                ),
                "liquidity_samples": sum(
                    x.get("liquidity") is not None for x in window
                ),
                "min_observed_liquidity": min(
                    (x["liquidity"] for x in window if x.get("liquidity") is not None),
                    default=None,
                ),
                "endpoint_liquidity": end.get("liquidity") if end else None,
                "executable_return": False,
                "between_samples": "unknown",
                "continuous_extrema_known": False,
                "stop_execution_assumed": False,
                "unsampled_intervals_seconds": [b - a for a, b in zip(times, times[1:])]
                + (
                    [max(0, min(at, target) - times[-1])]
                    if min(at, target) > times[-1]
                    else []
                ),
            }
            db.execute(
                "INSERT OR REPLACE INTO signal_outcomes VALUES(?,?,?,?)",
                (s["id"], minutes, status, dump(data)),
            )


def report(db, at):
    initialize(db)
    return {
        "tracked": db.execute("SELECT count(*) FROM tracking").fetchone()[0],
        "due": db.execute(
            "SELECT count(*) FROM tracking WHERE next_at<=?", (at,)
        ).fetchone()[0],
        "gaps": [
            dict(r)
            for r in db.execute(
                "SELECT * FROM sampling_gaps ORDER BY id DESC LIMIT 100"
            )
        ],
        "queue": [
            dict(r)
            for r in db.execute(
                "SELECT * FROM tracking ORDER BY priority DESC,next_at LIMIT 100"
            )
        ],
        "signals": [
            dict(r)
            for r in db.execute("SELECT * FROM signals ORDER BY id DESC LIMIT 100")
        ],
        "outcomes": [
            dict(r)
            for r in db.execute(
                "SELECT * FROM signal_outcomes ORDER BY signal_id DESC LIMIT 400"
            )
        ],
    }


def security_event(db, mint, result):
    previous = db.execute("SELECT * FROM security WHERE mint=?", (mint,)).fetchone()
    if previous:
        db.execute(
            "INSERT OR IGNORE INTO security_attempts(mint,observed_at,data) VALUES(?,?,?)",
            (mint, previous["observed_at"], previous["data"]),
        )
    db.execute(
        "INSERT OR IGNORE INTO security_attempts(mint,observed_at,data) VALUES(?,?,?)",
        (mint, result["observed_at"], dump(result)),
    )


def rebalance(db, at, cap=12):
    ranked = db.execute(
        "SELECT mint FROM tracking WHERE tier='fast' ORDER BY (pin_until>?) DESC,priority DESC,next_at,mint",
        (at,),
    ).fetchall()
    for row in ranked[cap:]:
        db.execute(
            "UPDATE tracking SET tier='follow',reason='fast_capacity_full',next_at=MAX(next_at,?) WHERE mint=?",
            (at + 1800, row["mint"]),
        )
