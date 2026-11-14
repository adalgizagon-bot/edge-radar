"""Read-only, exact-identity staging CPU/error metrics via Cloudflare GraphQL."""

import argparse
import datetime as dt
import json
import os
import urllib.request

WORKER = "edge-radar-monitor-staging"
QUERY = """
query StagingCPU($account: string, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject!) {
  viewer { accounts(filter: {accountTag: $account}) {
    summary: workersInvocationsAdaptive(limit: 1000, filter: $filter) {
      dimensions { scriptName scriptVersion status }
      sum { requests errors subrequests cpuTimeUs startupCpuTimeUs }
      max { cpuTime startupCpuTimeUs }
      quantiles { cpuTimeP50 cpuTimeP95 cpuTimeP99 startupCpuTimeUsP50 startupCpuTimeUsP95 startupCpuTimeUsP99 }
    }
    minutes: workersInvocationsAdaptive(limit: 10000, filter: $filter) {
      dimensions { datetimeMinute scriptName scriptVersion status }
      sum { requests errors subrequests cpuTimeUs startupCpuTimeUs }
      max { cpuTime startupCpuTimeUs }
    }
  } }
}
"""


def metrics(since, until, version=None):
    filters = {"scriptName": WORKER, "datetime_geq": since, "datetime_leq": until}
    if version:
        filters["scriptVersion"] = version
    variables = {"account": os.environ["CLOUDFLARE_ACCOUNT_ID"], "filter": filters}
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=json.dumps({"query": QUERY, "variables": variables}).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise RuntimeError(json.dumps(payload["errors"]))
    accounts = payload["data"]["viewer"]["accounts"]
    if len(accounts) != 1:
        raise RuntimeError("Expected exactly the authenticated account")
    result = accounts[0]
    for row in result["summary"] + result["minutes"]:
        identity = row["dimensions"]
        if identity["scriptName"] != WORKER:
            raise RuntimeError("Refusing metrics for another or unknown Worker")
        if identity["scriptVersion"] in (None, "", "__unknown__"):
            raise RuntimeError("Refusing metrics with unknown version")
        if version and identity["scriptVersion"] != version:
            raise RuntimeError("Refusing metrics for an unexpected Worker version")
    return {
        "worker": WORKER,
        "from": since,
        "to": until,
        "available": bool(result["summary"]),
        "cpu_unit": "microseconds",
        "source": "workersInvocationsAdaptive (adaptive sampling; delayed analytics)",
        **result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since", required=True, help="ISO 8601 timestamp with timezone"
    )
    parser.add_argument("--until", default=dt.datetime.now(dt.timezone.utc).isoformat())
    parser.add_argument("--version", help="Reject every version other than this UUID")
    args = parser.parse_args()
    start, end = (dt.datetime.fromisoformat(v) for v in (args.since, args.until))
    if start.tzinfo is None or end.tzinfo is None or start >= end:
        parser.error("Use an increasing timezone-aware interval")
    print(
        json.dumps(metrics(start.isoformat(), end.isoformat(), args.version), indent=2)
    )


if __name__ == "__main__":
    main()
