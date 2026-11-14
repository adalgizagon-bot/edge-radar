"""Prospective matched cohorts; observational comparisons are not causal returns."""

import hashlib
import math
import random
import statistics
from .db import dump, load, history, settings

PROTOCOL = {
    "version": "prospective-v1",
    "primary_horizon_minutes": 30,
    "horizons": [5, 15, 30, 60],
    "endpoint_tolerance_seconds": 180,
    "baseline_max_age_seconds": 300,
    "liquidity_ratio_bounds": [0.5, 2],
    "volume_ratio_bounds": [0.5, 2],
    "notional_usd": 20,
    "fee_per_side_bps": 100,
    "slippage_per_side_bps": 100,
    "network_fee_per_side_usd": 0.05,
    "min_pairs_for_inference": 100,
    "min_days_for_inference": 20,
}
SCHEMA = """
CREATE TABLE IF NOT EXISTS research_cohorts(id TEXT PRIMARY KEY,alert_mint TEXT NOT NULL,control_mint TEXT,alert_at INTEGER NOT NULL,protocol TEXT NOT NULL,data TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS research_time ON research_cohorts(alert_at);
CREATE INDEX IF NOT EXISTS research_pending ON research_cohorts(completed,alert_at);
CREATE TABLE IF NOT EXISTS research_outcomes(cohort_id TEXT NOT NULL REFERENCES research_cohorts(id),role TEXT NOT NULL,horizon INTEGER NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(cohort_id,role,horizon));
"""


def initialize(db):
    db.executescript(SCHEMA)


def age_bucket(x, at):
    age = at - x["pool_created"] if x.get("pool_created") else None
    return (
        None
        if age is None or age < 0
        else "new"
        if age < 86400
        else "young"
        if age < 3 * 86400
        else "old"
    )


def match(alert, candidates, at):
    """Only contemporaneously available snapshots; deterministic nearest log-distance."""
    eligible = []
    if (
        age_bucket(alert, at) is None
        or not 0 <= at - alert.get("observed_at", 0) <= 300
    ):
        return None
    for x in candidates:
        if (
            x["mint"] == alert["mint"]
            or x.get("source") != alert.get("source")
            or age_bucket(x, at) != age_bucket(alert, at)
        ):
            continue
        if (
            not 0
            <= at - x.get("observed_at", 0)
            <= PROTOCOL["baseline_max_age_seconds"]
        ):
            continue
        if (
            x.get("has_alert")
            or x.get("risk_class") != alert.get("risk_class")
            or not x.get("pool")
            or not (x.get("price") or 0) > 0
        ):
            continue
        ratios = [
            x.get(k) / alert[k]
            if x.get(k) is not None and alert.get(k) and alert[k] > 0
            else None
            for k in ["liquidity", "volume5m"]
        ]
        if any(r is None or not 0.5 <= r <= 2 for r in ratios):
            continue
        eligible.append((sum(abs(math.log(r)) for r in ratios), x["mint"], x))
    return min(eligible, key=lambda r: r[:2])[2] if eligible else None


def outcome(baseline, samples, alert_at, horizon, at, protocol=None):
    p = protocol or PROTOCOL
    target = alert_at + horizon * 60
    valid = sorted(
        [
            x
            for x in samples
            if alert_at < x["observed_at"] <= at
            and x.get("source") == baseline["source"]
            and x.get("pool") == baseline["pool"]
            and (x.get("price") or 0) > 0
        ],
        key=lambda x: x["observed_at"],
    )
    endpoint = next(
        (
            x
            for x in valid
            if target <= x["observed_at"] <= target + p["endpoint_tolerance_seconds"]
        ),
        None,
    )
    window = [x for x in valid if x["observed_at"] <= target]
    state = (
        "observed"
        if endpoint
        else "missing"
        if at > target + p["endpoint_tolerance_seconds"]
        else "pending"
    )
    r = endpoint["price"] / baseline["price"] - 1 if endpoint else None
    friction = (p["fee_per_side_bps"] + p["slippage_per_side_bps"]) / 10000
    net = (
        p["notional_usd"] * ((1 + r) * (1 - friction) / (1 + friction) - 1)
        - 2 * p["network_fee_per_side_usd"]
        if r is not None
        else None
    )
    prices = [baseline["price"]] + [x["price"] for x in window]
    times = [alert_at] + [x["observed_at"] for x in window]
    return state, {
        "target_at": target,
        "sample_at": endpoint["observed_at"] if endpoint else None,
        "price": endpoint["price"] if endpoint else None,
        "gross_return_pct": 100 * r if r is not None else None,
        "sampled_max_gain_pct": 100 * (max(prices) / baseline["price"] - 1),
        "sampled_max_drawdown_pct": 100 * (min(prices) / baseline["price"] - 1),
        "samples": len(window),
        "max_gap_seconds": max(
            [b - a for a, b in zip(times, times[1:])]
            + [max(0, min(at, target) - times[-1])]
        ),
        "entry_liquidity": baseline.get("liquidity"),
        "endpoint_liquidity": endpoint.get("liquidity") if endpoint else None,
        "min_observed_liquidity": min(
            (x["liquidity"] for x in window if x.get("liquidity") is not None),
            default=None,
        ),
        "net_scenario_usd": net,
        "estimated_cost_usd": p["notional_usd"] * r - net if net is not None else None,
        "cost_assumptions": {
            k: p[k]
            for k in [
                "notional_usd",
                "fee_per_side_bps",
                "slippage_per_side_bps",
                "network_fee_per_side_usd",
            ]
        },
        "between_samples": "unknown",
        "continuous_extrema_known": False,
        "stop_execution_assumed": False,
        "unsampled_intervals_seconds": [b - a for a, b in zip(times, times[1:])]
        + (
            [max(0, min(at, target) - times[-1])] if min(at, target) > times[-1] else []
        ),
        "execution_status": "unverified",
        "entry_quote": None,
        "exit_quote": None,
        "executable_net_usd": None,
    }


def enroll(db, results, at, max_fast=12):
    initialize(db)
    # Both arms are selected from exactly the information available this cycle.
    candidates = []
    for mint, r in results.items():
        x = dict(r.get("latest") or {})
        if not x or not 0 <= at - x.get("observed_at", 0) <= 300:
            continue
        a = r["assessment"]
        x["risk_class"] = (
            "flags"
            if a["flags"]
            else "incomplete"
            if a["scores"]["risk"] is None
            else "basic_checked"
        )
        x["has_alert"] = any(
            a["radars"][k]["detected"] for k in ["acceleration", "revival"]
        ) or bool(
            db.execute(
                "SELECT 1 FROM signals WHERE mint=? AND observed_at>=?",
                (mint, at - 3600),
            ).fetchone()
        )
        candidates.append(x)
    reserved = {
        r["mint"]
        for r in db.execute("SELECT mint FROM tracking WHERE pin_until>?", (at,))
    }
    for s in db.execute(
        "SELECT * FROM signals WHERE observed_at=? ORDER BY id", (at,)
    ).fetchall():
        if db.execute(
            "SELECT 1 FROM research_cohorts WHERE id=?", ("local-" + str(s["id"]),)
        ).fetchone():
            continue
        alert = next((x for x in candidates if x["mint"] == s["mint"]), None)
        if not alert:
            continue
        control = match(alert, [x for x in candidates if x["mint"] not in reserved], at)
        needed = {s["mint"]} | ({control["mint"]} if control else set())
        if len(reserved | needed) > max_fast:
            control = None
            needed = {s["mint"]}
        coverage = (
            "scheduled" if len(reserved | needed) <= max_fast else "capacity_limited"
        )
        data = {
            "protocol": PROTOCOL,
            "alert": alert,
            "control": control,
            "match_status": "matched" if control else "unmatched",
            "coverage": coverage,
            "signal_kind": s["kind"],
            "local_signal_id": s["id"],
            "detector_config": settings(db)[0],
            "detector_group": "python:"
            + hashlib.sha256(dump(settings(db)[0]).encode()).hexdigest()[:12],
        }
        db.execute(
            "INSERT INTO research_cohorts(id,alert_mint,control_mint,alert_at,protocol,data) VALUES(?,?,?,?,?,?)",
            (
                "local-" + str(s["id"]),
                s["mint"],
                control["mint"] if control else None,
                at,
                dump(PROTOCOL),
                dump(data),
            ),
        )
        if coverage == "scheduled":
            for mint in needed:
                db.execute(
                    "UPDATE tracking SET pin_until=MAX(pin_until,?),next_at=MIN(next_at,?),tier='fast' WHERE mint=?",
                    (at + 3780, at + 300, mint),
                )
            reserved |= needed


def evaluate(db, at):
    initialize(db)
    cohorts = db.execute(
        "SELECT * FROM research_cohorts WHERE completed=0 AND alert_at>=? ORDER BY alert_at LIMIT 200",
        (at - 86400,),
    ).fetchall()
    # Overdue cohorts remain eligible, even after long outages; process oldest first.
    if len(cohorts) < 200:
        cohorts += db.execute(
            "SELECT * FROM research_cohorts WHERE completed=0 AND alert_at<? ORDER BY alert_at LIMIT ?",
            (at - 86400, 200 - len(cohorts)),
        ).fetchall()
    for c in cohorts:
        data = load(c["data"])
        protocol = load(c["protocol"])
        for role in ["alert", "control"]:
            x = data.get(role)
            h = history(db, x["mint"]) if x else []
            for horizon in protocol["horizons"]:
                prev = db.execute(
                    "SELECT status FROM research_outcomes WHERE cohort_id=? AND role=? AND horizon=?",
                    (c["id"], role, horizon),
                ).fetchone()
                if prev and prev["status"] != "pending":
                    continue
                state, result = (
                    outcome(x, h, c["alert_at"], horizon, at, protocol)
                    if x
                    else (
                        "unmatched",
                        {
                            "gross_return_pct": None,
                            "net_scenario_usd": None,
                            "executable_net_usd": None,
                        },
                    )
                )
                db.execute(
                    "INSERT OR REPLACE INTO research_outcomes VALUES(?,?,?,?,?)",
                    (c["id"], role, horizon, state, dump(result)),
                )
        complete = db.execute(
            "SELECT count(*) FROM research_outcomes WHERE cohort_id=? AND status!='pending'",
            (c["id"],),
        ).fetchone()[0]
        if complete == 8:
            db.execute("UPDATE research_cohorts SET completed=1 WHERE id=?", (c["id"],))


def report(db, infer=True):
    initialize(db)
    cohorts = [
        dict(r)
        for r in db.execute("SELECT * FROM research_cohorts ORDER BY alert_at,id")
    ]
    results = {
        (r["cohort_id"], r["role"], r["horizon"]): (r["status"], load(r["data"]))
        for r in db.execute("SELECT * FROM research_outcomes")
    }
    groups = {}
    for c in cohorts:
        p = load(c["protocol"])
        version = p["version"]
        detector = load(c["data"]).get("detector_group", "legacy")
        for h in p["horizons"]:
            g = groups.setdefault(
                (version, detector, h),
                {
                    "version": version,
                    "detector_group": detector,
                    "horizon": h,
                    "cohorts": 0,
                    "matched": 0,
                    "paired_observed": 0,
                    "unavailable_pairs": 0,
                    "contaminated_controls": 0,
                    "missing_alert": 0,
                    "missing_control": 0,
                    "rows": [],
                },
            )
            g["cohorts"] += 1
            g["matched"] += int(bool(c["control_mint"]))
            later = bool(
                c["control_mint"]
                and db.execute(
                    "SELECT 1 FROM signals WHERE mint=? AND observed_at>? AND observed_at<=?",
                    (c["control_mint"], c["alert_at"], c["alert_at"] + h * 60),
                ).fetchone()
            )
            later = later or bool(
                c["control_mint"]
                and db.execute(
                    "SELECT 1 FROM research_cohorts WHERE alert_mint=? AND alert_at>? AND alert_at<=?",
                    (c["control_mint"], c["alert_at"], c["alert_at"] + h * 60),
                ).fetchone()
            )
            g["contaminated_controls"] += int(later)
            a = results.get((c["id"], "alert", h))
            b = results.get((c["id"], "control", h))
            g["missing_alert"] += int(bool(a and a[0] == "missing"))
            g["missing_control"] += int(bool(b and b[0] == "missing"))
            if (
                not a
                or not b
                or a[0] != "observed"
                or b[0] != "observed"
                or abs(a[1]["sample_at"] - b[1]["sample_at"]) > 180
            ):
                g["unavailable_pairs"] += 1
                continue
            g["paired_observed"] += 1
            g["rows"].append(
                {
                    "day": c["alert_at"] // 86400,
                    "mint": c["alert_mint"],
                    "difference_pct": a[1]["gross_return_pct"]
                    - b[1]["gross_return_pct"],
                    "alert_return_pct": a[1]["gross_return_pct"],
                    "control_return_pct": b[1]["gross_return_pct"],
                    "alert_net_scenario_usd": a[1]["net_scenario_usd"],
                    "control_net_scenario_usd": b[1]["net_scenario_usd"],
                    "gap_alert_seconds": a[1]["max_gap_seconds"],
                    "gap_control_seconds": b[1]["max_gap_seconds"],
                }
            )
    output = []
    for (version, detector, h), g in groups.items():
        rows = g.pop("rows")
        days = sorted({r["day"] for r in rows})
        deltas = [r["difference_pct"] for r in rows]
        g.update(
            {
                "distinct_days": len(days),
                "distinct_alert_contracts": len({r["mint"] for r in rows}),
                "mean_excess_return_pct": statistics.mean(deltas) if deltas else None,
                "median_excess_return_pct": statistics.median(deltas)
                if deltas
                else None,
                "mean_alert_return_pct": statistics.mean(
                    r["alert_return_pct"] for r in rows
                )
                if rows
                else None,
                "mean_control_return_pct": statistics.mean(
                    r["control_return_pct"] for r in rows
                )
                if rows
                else None,
                "mean_alert_net_scenario_usd": statistics.mean(
                    r["alert_net_scenario_usd"] for r in rows
                )
                if rows
                else None,
                "mean_control_net_scenario_usd": statistics.mean(
                    r["control_net_scenario_usd"] for r in rows
                )
                if rows
                else None,
                "ci95_day_block": None,
                "inference_status": "insufficient",
                "executable_profit_proven": False,
                "primary": h == 30,
            }
        )
        if infer and len(rows) >= 100 and len(days) >= 20:
            rng = random.Random(
                int(hashlib.sha256((version + str(h)).encode()).hexdigest()[:16], 16)
            )
            blocks = {
                day: [r["difference_pct"] for r in rows if r["day"] == day]
                for day in days
            }
            draws = []
            for _ in range(2000):
                values = [
                    x for day in rng.choices(days, k=len(days)) for x in blocks[day]
                ]
                draws.append(statistics.mean(values))
            draws.sort()
            g["ci95_day_block"] = [draws[49], draws[1949]]
            g["inference_status"] = "descriptive_block_interval_no_causal_claim"
        output.append(g)
    return {
        "protocol": PROTOCOL,
        "cohorts": len(cohorts),
        "recent": [
            {
                "id": c["id"],
                "alert_mint": c["alert_mint"],
                "control_mint": c["control_mint"],
                "alert_at": c["alert_at"],
                "data": load(c["data"]),
                "outcomes": [
                    {
                        "role": role,
                        "horizon": h,
                        "status": results[(c["id"], role, h)][0],
                        "data": results[(c["id"], role, h)][1],
                    }
                    for role in ["alert", "control"]
                    for h in [5, 15, 30, 60]
                    if (c["id"], role, h) in results
                ],
            }
            for c in cohorts[-30:]
        ],
        "groups": output,
        "note": "Primary: 30 min gross paired return. Secondary horizons exploratory. Missing pairs retained in denominators; later-alerting controls remain assigned. Day blocks do not remove all cross-day/token dependence. No executable edge established.",
    }
