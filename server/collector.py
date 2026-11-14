import argparse
import logging
import time
import uuid
from .db import connect, now, dump, load, settings, ingest, history, acquire
from .sources import HTTP, Market, Security, Social, Quotes, SourceError
from .analysis import evaluate, social_summary
from .paper import monitor, roundtrip, open_position

log = logging.getLogger("edge.collector")


def assessment(db, mint, at=None, quote=None):
    at = at or now()
    config, revision = settings(db)
    row = db.execute("SELECT * FROM tokens WHERE mint=?", (mint,)).fetchone()
    if not row:
        raise ValueError("Contrato não encontrado")
    token = dict(row)
    h = history(db, mint)
    r = db.execute("SELECT data FROM security WHERE mint=?", (mint,)).fetchone()
    security = load(r["data"]) if r else None
    social = social_summary(db, mint, at)
    result = evaluate(token, h, security, social, config, at, quote)
    return {
        "token": token,
        "latest": h[-1] if h else None,
        "assessment": result,
        "security": security,
        "social": social,
        "config_revision": revision,
    }


def collect(db, http=None):
    at = now()
    config, revision = settings(db)
    owner = uuid.uuid4().hex
    if not acquire(db, owner, at, ttl=900):
        return {"status": "busy"}
    run_id = None
    try:
        last = db.execute(
            "SELECT started_at FROM job_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if last and at - last["started_at"] < config["collect_seconds"]:
            return {
                "status": "not_due",
                "next_at": last["started_at"] + config["collect_seconds"],
            }
        run_id = db.execute(
            "INSERT INTO job_runs(started_at,status) VALUES(?,?)", (at, "running")
        ).lastrowid
        http = http or HTTP(db, budget=24)
        market = Market(http)
        failures = []
        rows = []

        def attempt(name, fn, default):
            try:
                return fn()
            except (SourceError, KeyError, ValueError, TypeError) as e:
                failures.append({"component": name, "error": str(e)[:180]})
                return default

        # Open positions first, before optional discovery and social traffic.
        attempt("paper_monitor", lambda: monitor(db, Quotes(http), now()), None)
        rows += attempt("new_pools", lambda: market.gecko("new"), [])
        # Rotate trending pages to include pools beyond the first ranking page.
        page = 1 + (run_id % 3)
        rows += attempt("trending_pools", lambda: market.gecko("trending", page), [])
        profiles = attempt("profiles", market.profiles, [])
        # Persisted queue does not depend on current ranking membership. Old tokens rotate fairly.
        watched = [
            r["mint"]
            for r in db.execute("""SELECT t.mint,MAX(s.observed_at) AS refreshed FROM tokens t LEFT JOIN snapshots s ON s.mint=t.mint
          WHERE t.active=1 GROUP BY t.mint ORDER BY refreshed ASC,t.first_seen ASC LIMIT 45""")
        ]
        open_mints = [
            r["mint"]
            for r in db.execute(
                "SELECT mint FROM trades WHERE status IN ('open','exit_unavailable')"
            )
        ]
        mints = list(
            dict.fromkeys(open_mints + profiles + watched + [r["mint"] for r in rows])
        )[:90]
        for i in range(0, len(mints), 30):
            rows += attempt(
                "token_refresh", lambda i=i: market.prices(mints[i : i + 30]), []
            )
        # Avoid provider order mixing: latest representative favors DEX within this cycle,
        # historical comparisons remain constrained to the same source and pool.
        unique = {}
        for x in rows:
            unique[(x["mint"], x["source"])] = x
        observed = now()
        ingest(db, list(unique.values()), observed)
        db.execute(
            "UPDATE tokens SET active=0,inactive_reason='Sem observação por prazo de expiração configurado' WHERE last_seen<? AND mint NOT IN (SELECT mint FROM trades WHERE status IN ('open','exit_unavailable'))",
            (observed - config["active_days"] * 86400,),
        )
        priority = [
            r["mint"]
            for r in db.execute(
                """SELECT t.mint,COALESCE(sec.observed_at,0) AS checked FROM tokens t LEFT JOIN security sec ON sec.mint=t.mint WHERE t.active=1 ORDER BY checked ASC,t.last_seen DESC LIMIT 2"""
            )
        ]
        for mint in priority:
            if config["security_enabled"]:

                def audit(mint=mint):
                    result = Security(http).inspect(mint)
                    db.execute(
                        "INSERT OR REPLACE INTO security VALUES(?,?,?)",
                        (mint, result["observed_at"], dump(result)),
                    )

                attempt("security", audit, None)
        social_mints = [
            r["mint"]
            for r in db.execute(
                """SELECT t.mint,COALESCE(s.observed_at,0) AS checked FROM tokens t LEFT JOIN social_checks s ON s.mint=t.mint WHERE t.active=1 ORDER BY checked ASC,t.last_seen DESC LIMIT 2"""
            )
        ]
        if config["social_enabled"]:
            for mint in social_mints:

                def scan_social(mint=mint):
                    posts = Social(http).search(mint)
                    checked = getattr(http, "last_observed_at", now())
                    previous = db.execute(
                        "SELECT data FROM social_checks WHERE mint=?", (mint,)
                    ).fetchone()
                    previous = load(previous["data"]) if previous else {}
                    coverage = (
                        previous.get("coverage_since", checked)
                        if previous.get("ok")
                        and checked - previous.get("last_success", 0) <= 1200
                        else checked
                    )
                    for p in posts:
                        db.execute(
                            "INSERT OR IGNORE INTO social VALUES(?,?,?,?,?,?,?)",
                            (
                                p["id"],
                                mint,
                                checked,
                                p["published_at"],
                                p["author"],
                                p["text"],
                                p["source"],
                            ),
                        )
                    db.execute(
                        "INSERT OR REPLACE INTO social_checks VALUES(?,?,?)",
                        (
                            mint,
                            checked,
                            dump(
                                {
                                    "ok": True,
                                    "coverage_since": coverage,
                                    "last_success": checked,
                                }
                            ),
                        ),
                    )

                attempt("social", scan_social, None)
        paper_opened = False
        for mint in dict.fromkeys(x["mint"] for x in rows):
            result = assessment(db, mint)
            a = result["assessment"]
            recent = db.execute(
                "SELECT id FROM trades WHERE mint=? AND (status!=? OR closed_at>?)",
                (mint, "closed", now() - 1800),
            ).fetchone()
            if (
                config["paper_auto"]
                and not paper_opened
                and not recent
                and all(c["passed"] is True for c in a["checks"] if c["key"] != "quote")
            ):

                def auto_open(mint=mint):
                    time.sleep(config["paper_latency_seconds"])
                    q = roundtrip(Quotes(http), mint, config, now())
                    current = assessment(db, mint, now(), q)
                    return open_position(
                        db, mint, current["assessment"], config, q, now()
                    )

                paper_opened = attempt("paper_entry", auto_open, None) is not None
            db.execute(
                "INSERT INTO assessments(mint,observed_at,config_version,data) VALUES(?,?,?,?)",
                (mint, now(), revision, dump(result["assessment"])),
            )
        summary = {
            "status": "partial" if failures else "ok",
            "observations": len(unique),
            "tokens": len({x["mint"] for x in rows}),
            "failures": failures,
            "requests_remaining": http.remaining,
            "observed_at": observed,
        }
        db.execute(
            "UPDATE job_runs SET finished_at=?,status=?,data=? WHERE id=?",
            (now(), summary["status"], dump(summary), run_id),
        )
        log.info("collection %s", dump(summary))
        return summary
    except Exception:
        if run_id:
            db.execute(
                "UPDATE job_runs SET finished_at=?,status=?,data=? WHERE id=?",
                (
                    now(),
                    "failed",
                    dump({"error": "Falha interna; consulte logs locais"}),
                    run_id,
                ),
            )
        raise
    finally:
        db.execute("DELETE FROM jobs WHERE name=? AND owner=?", ("collect", owner))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    db = connect()
    try:
        while True:
            try:
                result = collect(db)
                print(dump(result), flush=True)
            except Exception:
                log.exception("Collection failed")
                if args.once:
                    return 1
            else:
                if args.once:
                    # A degraded round with real observations can remain useful.
                    # A round blocked before receiving any data is not success.
                    if result["status"] == "partial" and not result["observations"]:
                        return 2
                    return 0
            time.sleep(15)
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
