import { PROTOCOL } from "./protocol.mjs";
export { PROTOCOL };
function bucket(x, at) {
  const age = x.pool_created ? at - x.pool_created : null;
  return age === null || age < 0
    ? null
    : age < 86400
      ? "new"
      : age < 259200
        ? "young"
        : "old";
}
export function detect(x, recent, baseline, at) {
  const samples = [...recent]
    .filter(
      (v) =>
        v.source === x.source &&
        v.pool === x.pool &&
        v.observed_at <= at &&
        v.price > 0,
    )
    .sort((a, b) => b.observed_at - a.observed_at);
  const spaced = [];
  for (const s of samples) {
    if (!spaced.length || spaced.at(-1).observed_at - s.observed_at >= 300)
      spaced.push(s);
    if (spaced.length === 3) break;
  }
  const consistent =
    spaced.length === 3 &&
    at - spaced.at(-1).observed_at <= 2400 &&
    spaced.every(
      (s, i) => i === 0 || spaced[i - 1].observed_at - s.observed_at <= 900,
    );
  if (!consistent || at - x.observed_at > 600 || at < x.observed_at)
    return null;
  const old = spaced[2],
    pressure =
      x.buys !== null && x.sells !== null && x.buys + x.sells > 0
        ? x.buys / (x.buys + x.sells)
        : null;
  const liq =
    x.liquidity !== null &&
    old.liquidity !== null &&
    x.liquidity >= old.liquidity;
  const growth = (key) =>
    old[key] > 0 && x[key] !== null ? x[key] / old[key] - 1 : null;
  const sustained =
    spaced.every((v) => v.volume5m !== null) &&
    spaced[0].volume5m >= spaced[1].volume5m &&
    spaced[1].volume5m >= spaced[2].volume5m;
  if (
    sustained &&
    liq &&
    x.liquidity >= 20000 &&
    x.volume5m >= 2000 &&
    pressure >= 0.6 &&
    pressure !== null &&
    growth("price") !== null &&
    growth("price") >= 0 &&
    growth("volume5m") >= 0.5 &&
    growth("buys") >= 0.25
  )
    return "acceleration";
  const older = baseline
    .filter(
      (v) =>
        v.source === x.source &&
        v.pool === x.pool &&
        at - v.observed_at >= 86400 &&
        at - v.observed_at <= 172800 &&
        v.volume5m !== null,
    )
    .sort((a, b) => a.observed_at - b.observed_at);
  const volumes = older.map((v) => v.volume5m).sort((a, b) => a - b),
    mid = Math.floor(volumes.length / 2),
    median =
      volumes.length % 2 ? volumes[mid] : (volumes[mid - 1] + volumes[mid]) / 2;
  if (
    bucket(x, at) === "old" &&
    older.length >= 6 &&
    older.at(-1).observed_at - older[0].observed_at >= 14400 &&
    median > 0 &&
    x.volume5m / median >= 3 &&
    pressure !== null &&
    pressure >= 0.6 &&
    liq
  )
    return "revival";
  return null;
}
export function match(alert, candidates, at) {
  if (
    bucket(alert, at) === null ||
    at - alert.observed_at < 0 ||
    at - alert.observed_at > 300
  )
    return null;
  return (
    candidates
      .filter(
        (x) =>
          x.mint !== alert.mint &&
          x.source === alert.source &&
          bucket(x, at) === bucket(alert, at) &&
          x.risk_class === alert.risk_class &&
          !x.has_alert &&
          x.pool &&
          x.price > 0 &&
          at - x.observed_at >= 0 &&
          at - x.observed_at <= 300 &&
          x.liquidity !== null &&
          alert.liquidity > 0 &&
          x.liquidity / alert.liquidity >= 0.5 &&
          x.liquidity / alert.liquidity <= 2 &&
          x.volume5m !== null &&
          alert.volume5m > 0 &&
          x.volume5m / alert.volume5m >= 0.5 &&
          x.volume5m / alert.volume5m <= 2,
      )
      .sort((a, b) => {
        const distance = (x) =>
          Math.abs(Math.log(x.liquidity / alert.liquidity)) +
          Math.abs(Math.log(x.volume5m / alert.volume5m));
        return distance(a) - distance(b) || a.mint.localeCompare(b.mint);
      })[0] || null
  );
}
export function outcome(baseline, samples, alertAt, horizon, at, p = PROTOCOL) {
  const target = alertAt + horizon * 60;
  const valid = samples
    .filter(
      (x) =>
        x.observed_at > alertAt &&
        x.observed_at <= at &&
        x.source === baseline.source &&
        x.pool === baseline.pool &&
        x.price > 0,
    )
    .sort((a, b) => a.observed_at - b.observed_at);
  const end = valid.find(
      (x) =>
        x.observed_at >= target &&
        x.observed_at <= target + p.endpoint_tolerance_seconds,
    ),
    window = valid.filter((x) => x.observed_at <= target);
  const status = end
    ? "observed"
    : at > target + p.endpoint_tolerance_seconds
      ? "missing"
      : "pending";
  const r = end ? end.price / baseline.price - 1 : null,
    friction = (p.fee_per_side_bps + p.slippage_per_side_bps) / 10000;
  const net =
    r === null
      ? null
      : p.notional_usd * (((1 + r) * (1 - friction)) / (1 + friction) - 1) -
        2 * p.network_fee_per_side_usd;
  const prices = [baseline.price, ...window.map((x) => x.price)],
    times = [alertAt, ...window.map((x) => x.observed_at)];
  return {
    status,
    data: {
      target_at: target,
      sample_at: end?.observed_at ?? null,
      price: end?.price ?? null,
      gross_return_pct: r === null ? null : 100 * r,
      sampled_max_gain_pct: 100 * (Math.max(...prices) / baseline.price - 1),
      sampled_max_drawdown_pct:
        100 * (Math.min(...prices) / baseline.price - 1),
      samples: window.length,
      max_gap_seconds: Math.max(
        ...times.slice(1).map((t, i) => t - times[i]),
        Math.max(0, Math.min(at, target) - times.at(-1)),
      ),
      entry_liquidity: baseline.liquidity,
      endpoint_liquidity: end?.liquidity ?? null,
      min_observed_liquidity: window.some((x) => x.liquidity !== null)
        ? Math.min(
            ...window
              .filter((x) => x.liquidity !== null)
              .map((x) => x.liquidity),
          )
        : null,
      net_scenario_usd: net,
      estimated_cost_usd: net === null ? null : p.notional_usd * r - net,
      cost_assumptions: Object.fromEntries(
        [
          "notional_usd",
          "fee_per_side_bps",
          "slippage_per_side_bps",
          "network_fee_per_side_usd",
        ].map((k) => [k, p[k]]),
      ),
      between_samples: "unknown",
      continuous_extrema_known: false,
      stop_execution_assumed: false,
      unsampled_intervals_seconds: [
        ...times.slice(1).map((t, i) => t - times[i]),
        ...(Math.min(at, target) > times.at(-1)
          ? [Math.min(at, target) - times.at(-1)]
          : []),
      ],
      execution_status: "unverified",
      entry_quote: null,
      exit_quote: null,
      executable_net_usd: null,
    },
  };
}
export async function research(db, states, transitions, best, at, read) {
  const writes = [],
    events = [];
  const snapshot = [...best.values()].map((x) => ({
    ...x,
    risk_class: "unavailable_on_worker",
    has_alert: false,
  }));
  for (const x of snapshot) {
    const recent = JSON.parse(transitions.get(x.mint).recent);
    let baseline = [];
    if (bucket(x, at) === "old" && recent.length >= 3) {
      const sql = Array.from(
        { length: 6 },
        () =>
          "SELECT data FROM (SELECT data FROM observations WHERE mint=? AND observed_at>=? AND observed_at<? ORDER BY observed_at LIMIT 1)",
      ).join(" UNION ALL ");
      const args = Array.from({ length: 6 }, (_, i) => [
        x.mint,
        at - 172800 + i * 14400,
        at - 172800 + (i + 1) * 14400,
      ]).flat();
      const r = await read(() =>
        db
          .prepare(sql)
          .bind(...args)
          .all(),
      );
      baseline = r.results.map((v) => JSON.parse(v.data));
    }
    x.kind = detect(x, recent, baseline, at);
    x.has_alert = !!x.kind || (states.get(x.mint)?.last_alert || 0) > at - 3600;
    if (x.kind && (states.get(x.mint)?.last_alert || 0) <= at - 3600)
      events.push(x);
  }
  // Fewer research units, sampled consistently. Admission is prospective and capacity constrained.
  const pinned = new Set(
    [...states.values()].filter((x) => x.pin_until > at).map((x) => x.mint),
  );
  let admitted = 0;
  const pins = [];
  for (const alert of events.sort((a, b) => a.mint.localeCompare(b.mint))) {
    if (admitted) break;
    let control = match(
      alert,
      snapshot.filter((x) => !pinned.has(x.mint)),
      at,
    );
    let needed = new Set([
      ...pinned,
      alert.mint,
      ...(control ? [control.mint] : []),
    ]);
    if (needed.size > 6) {
      control = null;
      needed = new Set([...pinned, alert.mint]);
    }
    if (needed.size > 6) continue;
    const id = `${alert.mint}:${at}`;
    const data = {
      protocol: PROTOCOL,
      alert,
      control,
      match_status: control ? "matched" : "unmatched",
      coverage: "scheduled",
      signal_kind: alert.kind,
      detector_group: "worker:stratified-v1",
    };
    writes.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO research_cohorts(id,alert_mint,control_mint,alert_at,protocol,data) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          id,
          alert.mint,
          control?.mint ?? null,
          at,
          JSON.stringify(PROTOCOL),
          JSON.stringify(data),
        ),
    );
    for (const mint of [alert.mint, ...(control ? [control.mint] : [])])
      writes.push(
        db
          .prepare(
            "UPDATE catalog SET pin_until=MAX(pin_until,?),tier='fast',next_at=?,study_pair=? WHERE mint=?",
          )
          .bind(at + 3780, at + 180, id, mint),
      );
    writes.push(
      db
        .prepare("UPDATE catalog SET last_alert=? WHERE mint=?")
        .bind(at, alert.mint),
    );
    pins.push(alert.mint, ...(control ? [control.mint] : []));
    admitted++;
  }
  const cohorts = await read(() =>
    db
      .prepare(
        "SELECT * FROM research_cohorts WHERE completed=0 ORDER BY alert_at LIMIT 4",
      )
      .all(),
  );
  let finalized = 0;
  for (const c of cohorts.results) {
    if (finalized >= 8) break;
    const data = JSON.parse(c.data),
      p = JSON.parse(c.protocol);
    const existing = await read(() =>
      db
        .prepare("SELECT role,horizon FROM research_outcomes WHERE cohort_id=?")
        .bind(c.id)
        .all(),
    );
    let completedNow = existing.results.length;
    for (const role of ["alert", "control"]) {
      if (finalized >= 8) break;
      const base = data[role];
      let samples = [];
      if (base && at >= c.alert_at + 300) {
        const rows = await read(() =>
          db
            .prepare(
              "SELECT data FROM observations WHERE mint=? AND observed_at>? AND observed_at<=? ORDER BY observed_at LIMIT 100",
            )
            .bind(base.mint, c.alert_at, Math.min(at, c.alert_at + 3780))
            .all(),
        );
        samples = rows.results.map((x) => JSON.parse(x.data));
        const current = best.get(base.mint);
        if (current) samples.push(current);
      }
      for (const h of p.horizons) {
        if (finalized >= 8) break;
        if (existing.results.some((x) => x.role === role && x.horizon === h))
          continue;
        const result = base
          ? outcome(base, samples, c.alert_at, h, at, p)
          : {
              status: "unmatched",
              data: {
                gross_return_pct: null,
                net_scenario_usd: null,
                executable_net_usd: null,
              },
            };
        if (result.status === "pending") continue;
        writes.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO research_outcomes VALUES(?,?,?,?,?)",
            )
            .bind(c.id, role, h, result.status, JSON.stringify(result.data)),
        );
        finalized++;
        completedNow++;
      }
    }
    if (completedNow === 8)
      writes.push(
        db
          .prepare("UPDATE research_cohorts SET completed=1 WHERE id=?")
          .bind(c.id),
      );
  }
  return { writes, candidates: events.length, admitted, finalized, pins };
}
