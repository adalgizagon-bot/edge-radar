"""Offline staging configuration review. No authentication, resources or deploys."""

import argparse
import json
from pathlib import Path
import tomllib
import uuid


def review(path="cloud-monitor/wrangler.toml"):
    config = tomllib.loads(Path(path).read_text())
    errors = []
    bindings = config.get("d1_databases", [])
    if config.get("name") != "edge-radar-monitor-staging":
        errors.append("Unexpected Worker name")
    if config.get("workers_dev") is not False or config.get("routes"):
        errors.append("Public routes must remain disabled")
    if config.get("vars", {}).get("MONITOR_ENABLED") != "false":
        errors.append("Monitoring must remain disabled for preparation")
    if config.get("triggers", {}).get("crons") != ["* * * * *"]:
        errors.append("Expected minute cron with internal dispatch budget")
    if (
        len(bindings) != 1
        or bindings[0].get("binding") != "MONITOR_DB"
        or bindings[0].get("database_name") != "edge-radar-monitor-staging"
    ):
        errors.append("Expected one isolated staging D1 binding")
    identity = bindings[0].get("database_id", "") if bindings else ""
    try:
        uuid.UUID(identity)
        configured = True
    except ValueError:
        configured = False
    return {
        "safe_preparation": not errors,
        "errors": errors,
        "database_id_configured": configured,
        "deploy_authorized": False,
        "remote_cpu_validated": False,
        "required_authorizations": [
            "Cloudflare account and explicit Free plan budget shared with other apps",
            "Create a NEW D1 edge-radar-monitor-staging; never use a legacy production ID",
            "Apply staging schema and configure its UUID",
            "Later authorize an isolated staging deployment with MONITOR_ENABLED=false",
            "Later authorize bounded pilot collection and profiling before continuous activation",
        ],
        "estimated_capacity": {
            "fast_contracts": 6,
            "warm_minutes": 3,
            "burst_contracts": 2,
            "burst_minutes": 1,
            "burst_window_minutes": 15,
            "burst_daily_minutes_max": 360,
            "full_load_samples_per_day_upper": 4512,
            "writes_reserved_per_day_upper": 64896,
            "automatic_write_pause": 45000,
            "automatic_read_pause": 2000000,
            "reservation_pause": 70000,
            "storage_pause_bytes": 350000000,
            "sample_reservation_ceiling": 140000,
        },
        "metrics_required": [
            "D1 meta.rows_read, meta.rows_written and meta.size_after",
            "Worker CPU dashboard p50/p95/p99 and limit-exceeded failures",
            "Source cache age, 429, Retry-After and observed intersample gaps",
        ],
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="cloud-monitor/wrangler.toml")
    args = p.parse_args()
    result = review(args.config)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["safe_preparation"] else 2)
