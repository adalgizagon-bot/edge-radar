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
  at = Math.floor(Date.now() / 1000),
) {
  if (env.MONITOR_ENABLED !== "true") return { status: "disabled" };
  const db = env.MONITOR_DB;
  // Reserve a conservative upper bound before outbound I/O. Failed runs consume reservation.
  // Stop on a storage reservation ceiling, never delete historical evidence automatically.
  const lock = await db
    .prepare(
      `UPDATE monitor_state SET lease_until=?,last_run=?,day=?,writes_reserved=CASE WHEN day=? THEN writes_reserved+160 ELSE 160 END,samples_reserved=samples_reserved+12 WHERE id=1 AND lease_until<? AND last_run<=? AND (day!=? OR writes_reserved<=49840) AND samples_reserved<=140000`,
    )
    .bind(
      at + 240,
      at,
      Math.floor(at / 86400),
      Math.floor(at / 86400),
      at,
      at - 290,
      Math.floor(at / 86400),
    )
    .run();
  if (!lock.meta.changes) return { status: "paused_or_busy" };
  const state = await db
    .prepare("SELECT * FROM monitor_state WHERE id=1")
    .first();
  const errors = [];
  const statements = [];
  let geckoAfter = state.gecko_after,
    dexAfter = state.dex_after;
  let count = 0;
  try {
    // Four fairness slots, five priority slots and up to three discoveries.
    const fair = await db
      .prepare(
        "SELECT mint FROM catalog WHERE next_at<=? ORDER BY last_attempt LIMIT 4",
      )
      .bind(at)
      .all();
    const ranked = await db
      .prepare(
        "SELECT mint FROM catalog WHERE next_at<=? ORDER BY priority DESC,next_at LIMIT 9",
      )
      .bind(at)
      .all();
    let mints = [
      ...new Set([...fair.results, ...ranked.results].map((x) => x.mint)),
    ].slice(0, 9);
    // Discover at most three new candidates; catalog remains durable outside rankings.
    if (geckoAfter <= at) {
      const r = await fetcher(
        "https://api.geckoterminal.com/api/v2/networks/solana/new_pools?page=1",
        { signal: AbortSignal.timeout(12000), redirect: "error" },
      );
      if (!r.ok) {
        geckoAfter = at + retryAfter(r.headers.get("Retry-After"), at);
        errors.push({ provider: "geckoterminal", status: r.status });
      } else {
        const raw = await r.json();
        if (!Array.isArray(raw.data)) throw new Error("invalid_gecko_schema");
        const candidates = [
          ...new Set(
            raw.data
              .map((x) =>
                x.relationships?.base_token?.data?.id?.replace(/^solana_/, ""),
              )
              .filter((x) => MINT.test(x || "")),
          ),
        ].slice(0, 3);
        mints = [...new Set([...mints, ...candidates])].slice(0, 12);
        for (const mint of candidates)
          statements.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO catalog(mint,first_seen,last_seen,next_at) VALUES(?,?,?,?)",
              )
              .bind(mint, at, at, at),
          );
      }
    }
    if (mints.length && dexAfter <= at) {
      const r = await fetcher(
        "https://api.dexscreener.com/tokens/v1/solana/" + mints.join(","),
        { signal: AbortSignal.timeout(12000), redirect: "error" },
      );
      if (!r.ok) {
        dexAfter = at + retryAfter(r.headers.get("Retry-After"), at);
        errors.push({ provider: "dexscreener", status: r.status });
      } else {
        const raw = await r.json();
        if (!Array.isArray(raw)) throw new Error("invalid_dex_schema");
        const best = new Map();
        const observedAt = Math.floor(Date.now() / 1000);
        for (const pair of raw) {
          const x = normalize(pair, observedAt);
          if (
            x &&
            mints.includes(x.mint) &&
            x.price > 0 &&
            (!best.has(x.mint) ||
              (x.liquidity || 0) > (best.get(x.mint).liquidity || 0))
          )
            best.set(x.mint, x);
        }
        for (const x of best.values()) {
          const p = priority(x);
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
                "UPDATE catalog SET last_seen=?,next_at=?,priority=?,last_attempt=? WHERE mint=?",
              )
              .bind(x.observed_at, at + (p >= 60 ? 300 : 1800), p, at, x.mint),
          );
          count++;
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
      errors.push({ provider: "dexscreener", reason: "backoff" });
    statements.push(
      db
        .prepare(
          "INSERT INTO monitor_runs(started_at,status,data) VALUES(?,?,?)",
        )
        .bind(
          at,
          errors.length ? "partial" : "ok",
          JSON.stringify({ observations: count, attempted: mints, errors }),
        ),
    );
    statements.push(
      db
        .prepare(
          "UPDATE monitor_state SET lease_until=0,gecko_after=?,dex_after=? WHERE id=1",
        )
        .bind(geckoAfter, dexAfter),
    );
    await db.batch(statements);
    return { status: errors.length ? "partial" : "ok", observations: count };
  } catch {
    // Sanitize errors, keep existing observations. Backoff both providers on transport/schema failure.
    await db.batch([
      db
        .prepare(
          "INSERT INTO monitor_runs(started_at,status,data) VALUES(?,'failed',?)",
        )
        .bind(at, JSON.stringify({ error: "transport_or_schema_failure" })),
      db
        .prepare(
          "UPDATE monitor_state SET lease_until=0,gecko_after=?,dex_after=? WHERE id=1",
        )
        .bind(Math.max(geckoAfter, at + 300), Math.max(dexAfter, at + 300)),
    ]);
    return { status: "failed" };
  }
}
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  async fetch() {
    return new Response("Staging sampler; no public API", { status: 404 });
  },
};
