import { boundedRequestOptions, failureDetails } from "./transport.mjs";
import { authorization } from "./authorization.mjs";
import { DUE_COHORT } from "./schedule.mjs";
// Staging sampler only. No production bindings, migrations, trades or public writes.
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = (x) =>
  x === null || x === undefined || x === "" || !Number.isFinite(Number(x))
    ? null
    : Number(x);
export function retryAfter(value, at) {
  const seconds = Number(value);
  const wait =
    value && Number.isFinite(seconds)
      ? Math.max(0, seconds)
      : Math.max(0, Date.parse(value) / 1000 - at || 0);
  return Math.ceil(Math.max(300, wait));
}
export function normalize(pair, at) {
  const mint = pair.baseToken?.address;
  if (pair.chainId !== "solana" || !MINT.test(mint || "")) return null;
  return {
    mint,
    name: String(pair.baseToken.name || "").slice(0, 128),
    symbol: String(pair.baseToken.symbol || "").slice(0, 32),
    source: "dexscreener",
    observed_at: at,
    pool: String(pair.pairAddress || "").slice(0, 64),
    pool_created: num(pair.pairCreatedAt)
      ? Math.floor(Number(pair.pairCreatedAt) / 1000)
      : null,
    price: num(pair.priceUsd),
    liquidity: num(pair.liquidity?.usd),
    volume5m: num(pair.volume?.m5),
    volume24h: num(pair.volume?.h24),
    buys: num(pair.txns?.m5?.buys),
    sells: num(pair.txns?.m5?.sells),
    unique_buyers: null,
    change5m: num(pair.priceChange?.m5),
    change1h: num(pair.priceChange?.h1),
    change24h: num(pair.priceChange?.h24),
    market_cap: num(pair.marketCap),
    fdv: num(pair.fdv),
  };
}
export function priority(x) {
  return x.liquidity >= 20000 &&
    x.volume5m >= 2000 &&
    x.buys !== null &&
    x.sells !== null &&
    x.buys + x.sells > 0 &&
    x.buys / (x.buys + x.sells) >= 0.6
    ? 60
    : 10;
}
export async function run(
  env,
  fetcher = fetch,
  at = Math.floor(Date.now() / 60000) * 60,
) {
  if (env.MONITOR_ENABLED !== "true") return { status: "disabled" };
  const auth = authorization(env);
  const maxDuration =
    env.PILOT_MAX_SECONDS === undefined ? 1800 : Number(env.PILOT_MAX_SECONDS);
  const db = env.MONITOR_DB,
    rotation = at % 180 === 0;
  const now = Math.floor(Date.now() / 1000),
    day = Math.floor(at / 86400);
  let reads = 0,
    writes = 0,
    bytes = 0,
    calls = 0,
    measured = true;
  const meter = async (operation) => {
    if (++calls > 45) throw Error("query_budget");
    const r = await operation();
    for (const x of Array.isArray(r) ? r : [r]) {
      const m = x.meta || {};
      if (m.rows_read === undefined || m.rows_written === undefined)
        measured = false;
      reads += m.rows_read || 0;
      writes += m.rows_written || 0;
      bytes = Math.max(bytes, m.size_after || 0);
    }
    return r;
  };
  // One small result, no probe JSON, catalog histories or cohort payloads.
  // SQLite CASE prevents queue lookups outside dispatch slots and when paused.
  const header = (
    await meter(() =>
      db
        .prepare(
          `
    SELECT s.*,p.used AS pilot_used,p.started_at AS pilot_start,p.expires_at AS pilot_end,
      CASE WHEN s.paused=0 AND s.db_bytes<350000000 AND s.samples_reserved<=140000
        AND (s.day!=? OR (s.rows_read<2000000 AND s.rows_written<45000 AND s.writes_reserved<70000))
        AND p.used=1 AND p.started_at<=? AND p.expires_at>? AND (?=1 OR s.burst_until>?) THEN (
        (s.dex_after<=? AND (EXISTS(SELECT 1 FROM catalog WHERE next_at<=?)
          OR EXISTS(SELECT 1 FROM catalog WHERE tier='fast')))
        + 2*EXISTS(SELECT 1 FROM catalog WHERE tier='fast' AND pin_until<=? AND last_seen<?)
        + 4*EXISTS(SELECT 1 FROM research_cohorts c WHERE ${DUE_COHORT})
      ) ELSE 0 END AS work_due
    FROM monitor_state s JOIN ${auth.source} p ON p.id=s.id
    WHERE s.id=1 AND s.purpose='edge-radar-staging' AND p.purpose='edge-radar-staging'
  `,
        )
        .bind(
          day,
          now,
          now,
          rotation ? 1 : 0,
          at,
          at,
          at,
          now,
          now - 600,
          now,
          ...auth.args,
        )
        .all(),
    )
  ).results[0];
  const live = () =>
    header &&
    header.pilot_used === 1 &&
    header.pilot_start <= Math.floor(Date.now() / 1000) &&
    header.pilot_end > Math.floor(Date.now() / 1000) &&
    Number.isInteger(maxDuration) &&
    maxDuration > 0 &&
    maxDuration <= 1800 &&
    header.pilot_end - header.pilot_start <= maxDuration;
  if (header && header.pilot_end <= now) return { status: "pilot_expired" };
  if (!live()) return { status: "pilot_not_authorized" };
  const reserveSlots = rotation ? (at % 900 === 0 ? 10 : 8) : 2;
  const reserveWrites = 40 + reserveSlots * 8;
  if (
    header.paused ||
    header.lease_until >= at ||
    header.last_run > at - 50 ||
    (!rotation && header.burst_until <= at) ||
    header.db_bytes >= 350000000 ||
    header.samples_reserved > 140000 - reserveSlots ||
    (header.day === day &&
      (header.writes_reserved > 70000 - reserveWrites ||
        header.rows_read >= 2000000 ||
        header.rows_written >= 45000))
  )
    return { status: "paused_or_busy" };
  const discoveryDue = at % 900 === 0 && header.gecko_after <= at;
  if (!discoveryDue && !header.work_due) return { status: "idle" };
  const { choose, transition, CAPACITY } = await import("./policy.mjs");
  const upstream = fetcher;
  fetcher = async (url, options = {}) => {
    if (!live()) throw Error("pilot_expired");
    return upstream(url, boundedRequestOptions(options, header.pilot_end));
  };
  const owner = crypto.randomUUID();
  const lock = await meter(() =>
    db
      .prepare(
        `UPDATE monitor_state SET lease_owner=?,lease_until=?,last_run=?,burst_minutes=CASE WHEN day!=? THEN MAX(0,CAST((MAX(0,burst_until-?)+59)/60 AS INTEGER)) ELSE burst_minutes END,day=?,writes_reserved=CASE WHEN day=? THEN writes_reserved+? ELSE ? END,rows_read=CASE WHEN day=? THEN rows_read ELSE 0 END,rows_written=CASE WHEN day=? THEN rows_written ELSE 0 END,samples_reserved=samples_reserved+? WHERE id=1 AND purpose='edge-radar-staging' AND paused=0 AND lease_until<? AND last_run<=? AND (?=1 OR burst_until>?) AND (day!=? OR writes_reserved<=?) AND (day!=? OR (rows_read<2000000 AND rows_written<45000)) AND db_bytes<350000000 AND samples_reserved<=? AND ${auth.guard} RETURNING *`,
      )
      .bind(
        owner,
        Math.max(at, Math.floor(Date.now() / 1000)) + 50,
        at,
        day,
        day * 86400,
        day,
        day,
        reserveWrites,
        reserveWrites,
        day,
        day,
        reserveSlots,
        at,
        at - 50,
        rotation ? 1 : 0,
        at,
        day,
        70000 - reserveWrites,
        day,
        140000 - reserveSlots,
        ...auth.args,
      )
      .all(),
  );
  if (!lock.results.length) return { status: "paused_or_busy" };
  const state = lock.results[0];
  const operations = {
    discovery_attempted: false,
    discovery_http_status: null,
    discovery_received_pools: 0,
    discovery_received_contracts: 0,
    discovery_candidates: [],
    dex_attempted: false,
    dex_http_status: null,
    dex_pairs_received: 0,
  };
  let geckoAfter = at,
    dexAfter = at,
    geckoFailures = 0,
    dexFailures = 0,
    stopReason = null;
  try {
    geckoAfter = state.gecko_after;
    dexAfter = state.dex_after;
    geckoFailures = state.gecko_failures;
    dexFailures = state.dex_failures;
    const collectQueues = (header.work_due & 3) !== 0;
    const fast = collectQueues
      ? (
          await meter(() =>
            db
              .prepare(
                "SELECT mint,last_seen,next_at,priority,last_attempt,tier,weak_streak,pin_until,last_alert,study_pair FROM catalog WHERE tier='fast' ORDER BY next_at LIMIT 12",
              )
              .all(),
          )
        ).results
      : [];
    const follow = collectQueues
      ? (
          await meter(() =>
            db
              .prepare(
                "SELECT mint,last_seen,next_at,priority,last_attempt,tier,weak_streak,pin_until,last_alert,study_pair FROM catalog INDEXED BY catalog_due WHERE next_at<=? ORDER BY last_attempt,mint LIMIT 64",
              )
              .bind(at)
              .all(),
          )
        ).results
      : [];
    const states = new Map([...fast, ...follow].map((x) => [x.mint, x]));
    const selected = choose(fast, follow, at, {
        rotation,
        burst: state.burst_until > at,
      }),
      errors = [],
      statements = [];
    let mints = selected.map((x) => x.mint),
      requested = [];
    // Discovery every 15 min: one HTTPS call, at most two candidate admissions.
    if (geckoAfter <= at && at % 900 === 0) {
      operations.discovery_attempted = true;
      const r = await fetcher(
        "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1",
        { signal: AbortSignal.timeout(12000), redirect: "manual" },
      );
      operations.discovery_http_status = r.status;
      if (!r.ok) {
        geckoFailures++;
        geckoAfter =
          at +
          Math.max(
            retryAfter(r.headers.get("Retry-After"), at),
            Math.min(3600, 300 * 2 ** Math.min(geckoFailures - 1, 4)),
          );
        errors.push({ provider: "geckoterminal", status: r.status });
        if (r.status === 403) stopReason = "provider_denied";
        if (r.status >= 300 && r.status < 400) stopReason = "provider_redirect";
      } else {
        const raw = await r.json();
        if (!Array.isArray(raw.data)) throw Error("invalid_gecko_schema");
        geckoFailures = 0;
        operations.discovery_received_pools = raw.data.length;
        const candidates = [],
          received = new Set(),
          seen = new Set(mints);
        for (const pool of raw.data) {
          const mint = pool.relationships?.base_token?.data?.id?.replace(
            /^solana_/,
            "",
          );
          if (MINT.test(mint || "")) received.add(mint);
          if (
            MINT.test(mint || "") &&
            !seen.has(mint) &&
            candidates.length < CAPACITY.discovery
          ) {
            seen.add(mint);
            candidates.push(mint);
          }
        }
        operations.discovery_received_contracts = received.size;
        operations.discovery_candidates = candidates;
        if (candidates.length) {
          const known = await meter(() =>
            db
              .prepare(
                `SELECT mint,last_seen,next_at,priority,last_attempt,tier,weak_streak,pin_until,last_alert,study_pair FROM catalog WHERE mint IN (${candidates.map(() => "?").join(",")})`,
              )
              .bind(...candidates)
              .all(),
          );
          for (const row of known.results) states.set(row.mint, row);
        }
        for (const mint of candidates) {
          if (!states.has(mint))
            states.set(mint, {
              mint,
              first_seen: at,
              last_seen: 0,
              next_at: at,
              priority: 0,
              last_attempt: 0,
              tier: "follow",
              pin_until: 0,
              last_alert: 0,
              recent: "[]",
              weak_streak: 0,
            });
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO catalog(mint,first_seen,last_seen,next_at) VALUES(?,?,?,?)",
              )
              .bind(mint, at, 0, at),
          );
        }
        mints = [...new Set([...mints, ...candidates])].slice(0, 12);
      }
    }
    const best = new Map(),
      transitions = new Map();
    if (mints.length && dexAfter <= at && !stopReason) {
      requested = mints;
      operations.dex_attempted = true;
      const r = await fetcher(
        "https://api.dexscreener.com/tokens/v1/solana/" + mints.join(","),
        { signal: AbortSignal.timeout(12000), redirect: "manual" },
      );
      operations.dex_http_status = r.status;
      if (!r.ok) {
        dexFailures++;
        dexAfter =
          at +
          Math.max(
            retryAfter(r.headers.get("Retry-After"), at),
            Math.min(3600, 300 * 2 ** Math.min(dexFailures - 1, 4)),
          );
        errors.push({ provider: "dexscreener", status: r.status });
        if (r.status === 403) stopReason = "provider_denied";
        if (r.status >= 300 && r.status < 400) stopReason = "provider_redirect";
      } else {
        const raw = await r.json();
        if (!Array.isArray(raw)) throw Error("invalid_dex_schema");
        dexFailures = 0;
        operations.dex_pairs_received = raw.length;
        const observedAt = Math.floor(Date.now() / 1000);
        const wanted = new Set(mints),
          winners = new Map();
        for (const pair of raw) {
          const mint = pair.baseToken?.address;
          if (
            pair.chainId !== "solana" ||
            !wanted.has(mint) ||
            !MINT.test(mint || "") ||
            !(num(pair.priceUsd) > 0) ||
            !String(pair.pairAddress || "").slice(0, 64)
          )
            continue;
          const liquidity = num(pair.liquidity?.usd) || 0;
          if (!winners.has(mint) || liquidity > winners.get(mint).liquidity)
            winners.set(mint, { pair, liquidity });
        }
        const responseDate = r.headers.get("Date"),
          cacheAge = num(r.headers.get("Age"));
        for (const { pair } of winners.values()) {
          const x = normalize(pair, observedAt);
          x.source_update_at = null;
          x.source_response_date = responseDate;
          x.source_cache_age_seconds = cacheAge;
          best.set(x.mint, x);
        }
        // Histories are needed only for observations that actually survived selection.
        if (best.size) {
          const ids = [...best.keys()];
          const details = await meter(() =>
            db
              .prepare(
                `SELECT * FROM catalog WHERE mint IN (${ids.map(() => "?").join(",")})`,
              )
              .bind(...ids)
              .all(),
          );
          for (const row of details.results) states.set(row.mint, row);
        }
        let fastCount = fast.filter(
          (x) => x.pin_until > at || at - x.last_seen <= 600,
        ).length;
        for (const x of best.values()) {
          const old = states.get(x.mint),
            t = transition(x, old, fastCount, at);
          transitions.set(x.mint, t);
          x.watch = t.watch;
          if (t.tier === "fast" && old.tier !== "fast") fastCount++;
          if (t.tier !== "fast" && old.tier === "fast") fastCount--;
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO observations(mint,observed_at,source,data) VALUES(?,?,?,?)",
              )
              .bind(x.mint, x.observed_at, x.source, JSON.stringify(x)),
          );
          statements.push(
            db
              .prepare(
                "UPDATE catalog SET last_seen=?,next_at=?,priority=?,last_attempt=?,tier=?,weak_streak=?,recent=?,reason=? WHERE mint=?",
              )
              .bind(
                x.observed_at,
                t.next_at,
                t.priority,
                at,
                t.tier,
                t.weak_streak,
                t.recent,
                t.reason,
                x.mint,
              ),
          );
        }
        for (const mint of mints.filter((m) => !best.has(m))) {
          errors.push({ mint, reason: "no_price" });
          statements.push(
            db
              .prepare(
                "UPDATE catalog SET last_attempt=?,next_at=? WHERE mint=?",
              )
              .bind(at, at + 1800, mint),
          );
        }
      }
    } else if (mints.length)
      errors.push({ provider: "dexscreener", reason: "backoff_or_pause" });
    const decisionAt = Math.floor(Date.now() / 1000);
    let study = {
      writes: [],
      candidates: 0,
      admitted: 0,
      finalized: 0,
      pins: [],
    };
    if (best.size || header.work_due & 4) {
      const { research } = await import("./research.mjs");
      study = await research(db, states, transitions, best, decisionAt, meter);
    }
    statements.push(...study.writes);
    const pinnedNow = [
      ...new Set(
        [...states.values()]
          .filter((x) => x.pin_until > decisionAt)
          .map((x) => x.mint)
          .concat(study.pins),
      ),
    ];
    const hotNow = [...states.values()]
      .map((x) => ({ ...x, ...(transitions.get(x.mint) || {}) }))
      .filter(
        (x) =>
          x.tier === "fast" &&
          !pinnedNow.includes(x.mint) &&
          decisionAt - (best.get(x.mint)?.observed_at ?? x.last_seen) <= 600,
      )
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.next_at - b.next_at ||
          a.mint.localeCompare(b.mint),
      );
    const admittedFast = new Set(
      [...pinnedNow, ...hotNow.map((x) => x.mint)].slice(0, 6),
    );
    for (const x of states.values()) {
      if (
        (x.tier === "fast" || transitions.get(x.mint)?.tier === "fast") &&
        !admittedFast.has(x.mint)
      )
        statements.push(
          db
            .prepare(
              "UPDATE catalog SET tier='follow',reason='fast_capacity_or_stale',next_at=MAX(next_at,?) WHERE mint=?",
            )
            .bind(at + 1800, x.mint),
        );
    }
    const carry =
      state.day === day
        ? state.burst_minutes
        : Math.max(0, Math.ceil((state.burst_until - day * 86400) / 60));
    let burstUntil = state.burst_until,
      burstNext = state.burst_next,
      burstMinutes = carry;
    if (
      rotation &&
      at >= burstNext &&
      burstMinutes <= 345 &&
      state.writes_reserved < 50000 &&
      state.rows_written < 35000 &&
      (hotNow.some((x) => x.priority >= 60 && x.weak_streak < 2) ||
        study.pins.length)
    ) {
      burstUntil = at + 900;
      burstNext = at + 3600;
      burstMinutes += 15;
    }
    const pause =
      stopReason ||
      (state.rows_read + reads >= 2000000 ||
      state.rows_written + writes >= 45000
        ? "daily_usage"
        : bytes >= 350000000
          ? "storage"
          : null);
    const details = {
      ...operations,
      observations: best.size,
      planned: mints,
      attempted: requested,
      errors,
      research_candidates: study.candidates,
      research_admitted: study.admitted,
      outcomes_finalized: study.finalized,
      usage_before_commit: { reads, writes, calls, bytes, measured },
      fast_limit: 6,
      burst_until: burstUntil,
      burst_reserved_minutes: burstMinutes,
      between_samples: "unknown",
    };
    statements.unshift(
      db
        .prepare(
          "UPDATE monitor_state SET lease_until=CASE WHEN lease_owner=? THEN lease_until ELSE NULL END WHERE id=1",
        )
        .bind(owner),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO monitor_runs(started_at,status,data) VALUES(?,?,?)",
        )
        .bind(at, errors.length ? "partial" : "ok", JSON.stringify(details)),
    );
    statements.push(
      db
        .prepare(
          "UPDATE monitor_state SET gecko_after=?,dex_after=?,gecko_failures=?,dex_failures=?,failure_streak=CASE WHEN ?>0 THEN 0 ELSE failure_streak END,burst_until=?,burst_next=?,burst_minutes=?,paused=CASE WHEN ? IS NOT NULL THEN 1 ELSE paused END,pause_reason=COALESCE(?,pause_reason) WHERE id=1",
        )
        .bind(
          geckoAfter,
          dexAfter,
          geckoFailures,
          dexFailures,
          best.size,
          burstUntil,
          burstNext,
          burstMinutes,
          pause,
          pause,
        ),
    );
    // Abort the atomic batch if the deadline passed while providers were responding.
    statements.unshift(
      db
        .prepare(
          `UPDATE monitor_state SET lease_until=CASE WHEN ${auth.guard} AND paused=0 THEN lease_until ELSE NULL END WHERE id=1`,
        )
        .bind(...auth.args),
    );
    if (!live()) throw Error("pilot_expired");
    await meter(() => db.batch(statements));
    // Reserving first survives crashes; measured totals include the data batch, with a small allowance for this update itself.
    await meter(() =>
      db
        .prepare(
          "UPDATE monitor_state SET rows_read=rows_read+?,rows_written=rows_written+?,db_bytes=MAX(db_bytes,?),paused=CASE WHEN rows_read+?>=2000000 OR rows_written+?>=45000 OR ?>=350000000 THEN 1 ELSE paused END,pause_reason=CASE WHEN rows_read+?>=2000000 OR rows_written+?>=45000 THEN 'daily_usage' WHEN ?>=350000000 THEN 'storage' ELSE pause_reason END,lease_until=0,lease_owner=NULL WHERE id=1 AND lease_owner=?",
        )
        .bind(
          reads + 2,
          writes + 2,
          bytes,
          reads + 2,
          writes + 2,
          bytes,
          reads + 2,
          writes + 2,
          bytes,
          owner,
        )
        .run(),
    );
    console.log(
      JSON.stringify({
        monitor_at: at,
        rows_read: reads,
        rows_written: writes,
        db_bytes: bytes,
        queries: calls,
        measured,
      }),
    );
    return {
      status: errors.length ? "partial" : "ok",
      observations: best.size,
    };
  } catch (error) {
    // Data batch is atomic. An expired owner cannot overwrite the next owner's state.
    await db.batch([
      db
        .prepare(
          "INSERT INTO monitor_runs(started_at,status,data) SELECT ?,'failed',? WHERE EXISTS(SELECT 1 FROM monitor_state WHERE id=1 AND lease_owner=?)",
        )
        .bind(
          at,
          JSON.stringify({
            ...operations,
            ...failureDetails(error, operations),
            error: "transport_schema_or_storage_failure",
            reads,
            writes,
            calls,
          }),
          owner,
        ),
      db
        .prepare(
          "UPDATE monitor_state SET lease_until=0,lease_owner=NULL,failure_streak=failure_streak+1,paused=CASE WHEN failure_streak>=2 THEN 1 ELSE paused END,pause_reason=CASE WHEN failure_streak>=2 THEN 'repeated_failure' ELSE pause_reason END,gecko_after=MAX(gecko_after,?),dex_after=MAX(dex_after,?),rows_read=rows_read+?,rows_written=rows_written+? WHERE id=1 AND lease_owner=?",
        )
        .bind(
          Math.max(geckoAfter, at + 300),
          Math.max(dexAfter, at + 300),
          reads + 4,
          writes + 4,
          owner,
        ),
    ]);
    return { status: "failed" };
  }
}
export async function probe(env) {
  const auth = authorization(env);
  const row = await env.MONITOR_DB.prepare(auth.probeSelect)
    .bind(...auth.args)
    .first();
  if (!row || row.probe_requested <= row.probe_completed) return;
  // The integration probe can only run against an expired, unused authorization.
  if (row.used !== 0 || row.expires_at > Math.floor(Date.now() / 1000)) return;
  let outbound = 0;
  const result = await run({ ...env, MONITOR_ENABLED: "true" }, () => {
    outbound++;
    throw Error("probe must never contact a provider");
  });
  if (outbound || result.status !== "pilot_expired")
    throw Error("shutdown_probe_failed");
  const integrity = await env.MONITOR_DB.prepare("PRAGMA quick_check").all();
  if (integrity.results.some((x) => x.quick_check !== "ok"))
    throw Error("probe_integrity_failed");
  const proof = JSON.stringify({
    status: result.status,
    outbound,
    quick_check: "ok",
    read_write: "ok",
  });
  await env.MONITOR_DB.prepare(auth.probeUpdate)
    .bind(proof, ...auth.args)
    .run();
  console.log(JSON.stringify({ shutdown_probe: proof }));
}
export default {
  async scheduled(event, env, ctx) {
    if (Date.now() - event.scheduledTime > 30000) {
      console.log("late_tick_skipped");
      return;
    }
    ctx.waitUntil(
      (async () => {
        if (env.SHUTDOWN_PROBE_ENABLED === "true") await probe(env);
        const result = await run(
          env,
          fetch,
          Math.floor(event.scheduledTime / 60000) * 60,
        );
        console.log(JSON.stringify({ dispatch: result }));
      })(),
    );
  },
  async fetch() {
    return new Response("Staging sampler; no public API", { status: 404 });
  },
};
