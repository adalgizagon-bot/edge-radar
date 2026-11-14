// Local-only synthetic fixtures. Never reads Cloudflare credentials or calls a provider.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { setup } from "../tests/helpers/monitor-db.mjs";
import * as optimized from "../cloud-monitor/worker.mjs";
import { PROTOCOL } from "../cloud-monitor/protocol.mjs";

const ref = process.argv[2] || "507d7b7";
const repeats = Number(process.argv[3] || 5);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 30);
const folder = mkdtempSync(join(tmpdir(), "edge-cpu-baseline-"));
for (const file of ["worker", "policy", "research", "protocol"])
  writeFileSync(
    join(folder, file + ".mjs"),
    execFileSync("git", ["show", `${ref}:cloud-monitor/${file}.mjs`]),
  );
const baseline = await import(pathToFileURL(join(folder, "worker.mjs")));
const originalNow = Date.now;
const log = console.log;
const base = Math.floor(originalNow() / 900000) * 900;
const mint = "So11111111111111111111111111111111111111112";
const control = "11111111111111111111111111111111";
const ids = Array.from(
  { length: 64 },
  (_, i) =>
    "A".repeat(30) +
    String.fromCharCode(65 + Math.floor(i / 16)) +
    "ABCDEFGHJKLMNPQR"[i % 16],
);
const pair = (m = mint, liquidity = 50000) => ({
  chainId: "solana",
  baseToken: { address: m, name: "SYNTHETIC BENCHMARK", symbol: "FIXTURE" },
  pairAddress: "pool-" + m,
  priceUsd: "1",
  liquidity: { usd: liquidity },
  volume: { m5: 5000 },
  txns: { m5: { buys: 40, sells: 10 } },
  pairCreatedAt: (base - 7 * 86400) * 1000,
});
const obs = (m, t, extra = {}) => ({
  ...optimized.normalize(pair(m), t),
  ...extra,
});
const insert = (
  s,
  m,
  at,
  { tier = "follow", next = at, last = at - 180, recent = [] } = {},
) =>
  s.db
    .prepare(
      "INSERT INTO catalog(mint,first_seen,last_seen,next_at,priority,last_attempt,tier,recent) VALUES(?,?,?,?,?,?,?,?)",
    )
    .bind(
      m,
      at - 900,
      last,
      next,
      tier === "fast" ? 60 : 10,
      last,
      tier,
      JSON.stringify(recent),
    );
const cases = [
  "disabled_tick",
  "expired",
  "empty_rotation",
  "future_catalog",
  "empty_discovery",
  "discovery_many_pairs",
  "requery",
  "priority",
  "alerts_controls",
  "pending_outcomes",
  "future_outcomes",
  "api_failure",
  "expiry_during_response",
];

async function fixture(name) {
  const at = [
    "empty_discovery",
    "discovery_many_pairs",
    "expiry_during_response",
  ].includes(name)
    ? base
    : base + 180;
  Date.now = () => at * 1000;
  const s = setup(
    name === "expired" ? { start: base - 120, end: base - 60 } : {},
  );
  let gecko = { data: [] },
    dex = [];
  if (name === "future_catalog") {
    await s.db.batch(
      ids.map((m) =>
        insert(s, m, at, {
          next: at + 1800,
          recent: Array.from({ length: 14 }, (_, i) =>
            obs(m, at - 3000 + i * 180),
          ),
        }),
      ),
    );
  }
  if (["requery", "priority", "api_failure"].includes(name)) {
    await s.db.batch(
      ids.map((m, i) =>
        insert(s, m, at, {
          next: i < 8 ? at : at + 1800,
          tier: name === "priority" && i < 6 ? "fast" : "follow",
          recent: Array.from({ length: 14 }, (_, j) =>
            obs(m, at - 2700 + j * 180),
          ),
        }),
      ),
    );
    dex = ids
      .slice(0, 8)
      .flatMap((m) =>
        Array.from({ length: 25 }, (_, i) => pair(m, 30000 + i * 1000)),
      );
  }
  if (["discovery_many_pairs", "expiry_during_response"].includes(name)) {
    gecko = {
      data: Array.from({ length: 1000 }, (_, i) => ({
        relationships: {
          base_token: { data: { id: "solana_" + (i % 2 ? mint : control) } },
        },
      })),
    };
    dex = Array.from({ length: 1000 }, (_, i) =>
      pair(i % 2 ? mint : control, 20000 + i),
    );
  }
  if (name === "alerts_controls") {
    for (const m of [mint, control])
      await insert(s, m, at, {
        tier: "fast",
        recent: [
          obs(m, at - 600, {
            price: 0.95,
            volume5m: m === mint ? 2000 : 5000,
            buys: 25,
          }),
          obs(m, at - 300, {
            price: 0.97,
            volume5m: m === mint ? 4000 : 5000,
            buys: 40,
          }),
        ],
      }).run();
    dex = [
      {
        ...pair(mint),
        volume: { m5: 6000 },
        txns: { m5: { buys: 50, sells: 10 } },
      },
      pair(control),
    ];
  }
  if (["pending_outcomes", "future_outcomes"].includes(name)) {
    const alertAt = name === "pending_outcomes" ? at - 4000 : at;
    const alert = obs(mint, alertAt),
      comparison = obs(control, alertAt);
    await s.db
      .prepare(
        "INSERT INTO research_cohorts(id,alert_mint,control_mint,alert_at,protocol,data) VALUES('fixture',?,?,?,?,?)",
      )
      .bind(
        mint,
        control,
        alertAt,
        JSON.stringify(PROTOCOL),
        JSON.stringify({ alert, control: comparison }),
      )
      .run();
    if (name === "pending_outcomes")
      for (const m of [mint, control])
        for (const h of PROTOCOL.horizons) {
          const x = obs(m, alertAt + h * 60, { price: 1.1 });
          await s.db
            .prepare(
              "INSERT INTO observations(mint,observed_at,source,data) VALUES(?,?,?,?)",
            )
            .bind(m, x.observed_at, x.source, JSON.stringify(x))
            .run();
        }
  }
  const geckoBody = JSON.stringify(gecko),
    dexBody = JSON.stringify(dex);
  let outbound = 0;
  const fetcher = async (url) => {
    outbound++;
    if (name === "api_failure")
      return new Response("", {
        status: 503,
        headers: { "Retry-After": "300" },
      });
    if (name === "expiry_during_response")
      Date.now = () => (Math.floor(base / 900) * 900 + 1801) * 1000;
    return new Response(url.includes("geckoterminal") ? geckoBody : dexBody, {
      headers: {
        "Content-Type": "application/json",
        Date: "Sat, 14 Nov 2026 00:00:00 GMT",
        Age: "1",
      },
    });
  };
  return { s, at, fetcher, outbound: () => outbound };
}
async function quality(s) {
  const tables = {};
  for (const table of [
    "catalog",
    "observations",
    "research_cohorts",
    "research_outcomes",
  ]) {
    const rows = (await s.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all())
      .results;
    tables[table] = rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          ["data", "protocol", "recent"].includes(k) ? JSON.parse(v) : v,
        ]),
      ),
    );
  }
  return tables;
}
async function measure(module, name) {
  const f = await fixture(name),
    { s, at, fetcher } = f;
  s.resetStats();
  const cpu = process.cpuUsage(),
    wall = performance.now();
  let result;
  if (name === "disabled_tick") {
    const promises = [];
    await module.default.scheduled(
      { scheduledTime: at * 1000 },
      { ...s.env, MONITOR_ENABLED: "false" },
      { waitUntil: (p) => promises.push(p) },
    );
    await Promise.all(promises);
    result = { status: "disabled" };
  } else result = await module.run(s.env, fetcher, at);
  const elapsed = performance.now() - wall,
    used = process.cpuUsage(cpu);
  const stats = { ...s.stats };
  const output = {
    result,
    calls: stats.calls,
    statements: stats.statements,
    mutations: stats.mutations,
    returned_rows: stats.rows,
    result_bytes: stats.bytes,
    js_cpu_us: Math.max(0, used.user + used.system - stats.adapterCpuUs),
    wall_ms: elapsed,
    outbound: f.outbound(),
  };
  output.quality = await quality(s);
  s.clean();
  return output;
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
try {
  console.log = () => {};
  const results = [];
  for (const name of cases) {
    const a = [],
      b = [];
    for (let i = 0; i < repeats; i++) {
      // Alternate order to reduce a fixed warmup/order advantage.
      let old, newer;
      if (i % 2) {
        newer = await measure(optimized, name);
        old = await measure(baseline, name);
      } else {
        old = await measure(baseline, name);
        newer = await measure(optimized, name);
      }
      assert.deepEqual(newer.quality, old.quality, `data parity: ${name}`);
      assert.equal(newer.outbound, old.outbound, `provider cadence: ${name}`);
      a.push(old);
      b.push(newer);
    }
    const summarize = (items) =>
      Object.fromEntries(
        [
          "calls",
          "statements",
          "mutations",
          "returned_rows",
          "result_bytes",
          "js_cpu_us",
          "wall_ms",
          "outbound",
        ].map((k) => [k, median(items.map((x) => x[k]))]),
      );
    results.push({
      scenario: name,
      baseline: summarize(a),
      optimized: summarize(b),
      quality_parity: true,
    });
  }
  process.stdout.write(
    JSON.stringify(
      {
        baseline_ref: ref,
        optimized_source_sha256: createHash("sha256")
          .update(
            ["worker", "policy", "research", "protocol", "schedule"]
              .map((name) =>
                readFileSync(
                  new URL(`../cloud-monitor/${name}.mjs`, import.meta.url),
                  "utf8",
                ),
              )
              .join("\n"),
          )
          .digest("hex"),
        repeats,
        fixtures: "synthetic; exact SQLite SQL; no real network",
        timing:
          "local process CPU less SQLite adapter CPU; includes Node/runtime noise, not Cloudflare CPU; wall includes Python/SQLite subprocesses",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  Date.now = originalNow;
  console.log = log;
  rmSync(folder, { recursive: true, force: true });
}
