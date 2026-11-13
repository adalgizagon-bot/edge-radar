#!/usr/bin/env python3
"""Read-only report of the public Edge Radar paper-trading audit endpoint.
No keys, wallets, trading actions or API calls to paid providers.
"""
import collections
import datetime as dt
import json
import statistics
import urllib.request

URL="https://edge-radar-cloud.adalgizagon.workers.dev/api/audit?limit=1000"
request=urllib.request.Request(URL,headers={"User-Agent":"Edge-Radar-Audit/1.0","Accept":"application/json","Cache-Control":"no-cache"})
with urllib.request.urlopen(request,timeout=25) as response:
    assert response.status==200, f"API returned {response.status}"
    data=json.load(response)
assert isinstance(data.get("rows"),list),"Bad response: missing rows"
rows=data["rows"]
def number(x):
    try:
        if x is None or x == "": return None
        return float(x)
    except (ValueError,TypeError):return None
def summary(xs):
    good=[number(x.get("pnl_usd")) for x in xs]
    good=[v for v in good if v is not None]
    wins=sum(v>0 for v in good)
    stress=[number(x.get("stress_pnl_usd")) for x in xs]
    stress=[v for v in stress if v is not None]
    return {"n":len(xs),"wins":wins,"win_rate":round(100*wins/len(good),1) if good else None,
      "pnl_usd":round(sum(good),3),"stress_usd":round(sum(stress),3) if stress else None,
      "avg_pnl_usd":round(statistics.mean(good),3) if good else None,
      "avg_win_usd":round(statistics.mean([v for v in good if v>0]),3) if wins else None,
      "avg_loss_usd":round(statistics.mean([v for v in good if v<=0]),3) if wins<len(good) else None,
      "avg_duration_min":round(statistics.mean([number(x["duration_minutes"]) for x in xs if number(x.get("duration_minutes")) is not None]),2) if any(number(x.get("duration_minutes")) is not None for x in xs) else None}
def by_group(xs,key):
    groups=collections.defaultdict(list)
    for x in xs:groups[str(x.get(key) or "sem_registro")].append(x)
    return {k:summary(v) for k,v in sorted(groups.items(),key=lambda pair:-len(pair[1]))}
def condensed(xs):
    return [{"closed_at":x.get("closed_at"),"symbol":x.get("symbol"),"pnl_usd":x.get("pnl_usd"),
      "duration_minutes":x.get("duration_minutes"),"price_return_pct":x.get("price_return_pct"),
      "reason":x.get("exit_reason"),"reason_group":x.get("reason_group"),
      "tier":x.get("tier"),"score":x.get("score"),"liquidity":x.get("liquidity"),
      "volume5m":x.get("volume5m"),"change5m":x.get("change5m"),
      "stop_overshoot_pct":x.get("stop_overshoot_pct"),"sample_count":x.get("sample_count")}
      for x in xs]
def analysis(xs):
    losses=[x for x in xs if (number(x.get("pnl_usd")) or 0)<0]
    win=[x for x in xs if (number(x.get("pnl_usd")) or 0)>0]
    return {"totals":summary(xs),
      "by_exit_reason":by_group(xs,"reason_group"),"by_tier":by_group(xs,"tier"),
      "by_quote_status":by_group(xs,"quote_status"),
      "stop_trades":summary([x for x in xs if x.get("reason_group")=="stop"]),
      "no_entry_volume_count":sum(x.get("volume5m") is None for x in xs),
      "no_entry_score_count":sum(x.get("score") is None for x in xs),
      "no_samples_count":sum((number(x.get("sample_count")) or 0)==0 for x in xs),
      "stop_overshoot_recorded_count":sum(x.get("stop_overshoot_pct") is not None for x in xs),
      "worst_6":condensed(sorted(losses,key=lambda x:number(x["pnl_usd"]))[:6]),
      "best_4":condensed(sorted(win,key=lambda x:-number(x["pnl_usd"]))[:4]),
      "durations_over_max":sum((number(x.get("duration_minutes")) or 0)>7 for x in xs)}
forwardStart=number(data.get("v2Since"))
strategies=["baseline","scalp","scalp_v2"]
report={
 "checkedAt":data.get("checkedAt"),"totalClosed":data.get("totalClosed"),"returnedRows":len(rows),
 "complete":data.get("complete"),"comparisonSince":data.get("comparisonSince"),
 "v2Since":data.get("v2Since"),"apiSummary":data.get("summary"),
 "apiForwardSummary":data.get("forwardSummary"),
 "strategies":{s:analysis([x for x in rows if x.get("strategy")==s]) for s in strategies},
 "forward":{s:analysis([x for x in rows if x.get("strategy")==s and forwardStart is not None and (number(x.get("closed_at")) or 0)>=forwardStart]) for s in strategies},
}
print("=== EDGE_AUDIT_JSON_START ===")
print(json.dumps(report,ensure_ascii=False,indent=2))
print("=== EDGE_AUDIT_JSON_END ===")
