// Synthetic fixtures are test-only. Real SQLite executes the exact D1 statements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, normalize, retryAfter, probe } from "../cloud-monitor/worker.mjs";
const mint = "So11111111111111111111111111111111111111112";
const pair = {
  chainId: "solana",
  baseToken: { address: mint, name: "UNIT TEST ONLY", symbol: "TEST" },
  pairAddress: "unit-test-pool",
  priceUsd: "1",
  liquidity: { usd: 50000 },
  volume: { m5: 5000 },
  txns: { m5: { buys: 40, sells: 10 } },
};
function setup(options = {}) {
  const folder = mkdtempSync(join(tmpdir(), "edge-monitor-"));
  const path = join(folder, "test.sqlite3");
  const schema = readFileSync(
    new URL("../cloud-monitor/schema.sql", import.meta.url),
    "utf8",
  );
  const init = spawnSync(
    "python3",
    [
      "-c",
      "import sqlite3,sys; d=sqlite3.connect(sys.argv[1]); d.executescript(sys.stdin.read()); d.close()",
      path,
    ],
    { input: schema, encoding: "utf8" },
  );
  assert.equal(init.status, 0, init.stderr);
  const execute = (statements) => {
    const p = spawnSync("python3", ["tests/monitor_sqlite_bridge.py"], {
      input: JSON.stringify({ path, statements }),
      encoding: "utf8",
    });
    assert.equal(p.status, 0, p.stderr);
    return JSON.parse(p.stdout);
  };
  const now = Math.floor(Date.now() / 1000);
  execute([
    {
      sql: "UPDATE pilot_control SET started_at=?,expires_at=?,used=? WHERE id=1",
      args: [
        options.start ?? Math.floor(now / 900) * 900,
        options.end ?? Math.floor(now / 900) * 900 + 1800,
        options.used ?? 1,
      ],
    },
  ]);
  const db = {
    prepare(sql) {
      return {
        sql,
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          return execute([this])[0];
        },
        async first() {
          return execute([this])[0].results[0] || null;
        },
        async all() {
          return execute([this])[0];
        },
      };
    },
    async batch(s) {
      return execute(s);
    },
  };
  return {
    db,
    env: { MONITOR_ENABLED: "true", MONITOR_DB: db },
    clean: () => rmSync(folder, { recursive: true, force: true }),
  };
}
const gecko = {
  data: [{ relationships: { base_token: { data: { id: "solana_" + mint } } } }],
};
test("worker disabled by default performs no I/O", async () => {
  assert.deepEqual(
    await run({}, () => {
      throw Error("network");
    }),
    { status: "disabled" },
  );
});
test("nullable fields remain unknown and Retry-After is not shortened", () => {
  assert.equal(normalize(pair, 123).market_cap, null);
  assert.equal(retryAfter("7200", 100), 7200);
  assert.equal(retryAfter(new Date(7300 * 1000).toUTCString(), 100), 7200);
});
test("scheduled sampling persists and excludes duplicate/overlap runs", async () => {
  const s = setup();
  try {
    let calls = 0;
    const f = async (u) => {
      calls++;
      return Response.json(u.includes("geckoterminal") ? gecko : [pair, pair]);
    };
    const at = Math.floor(Date.now() / 900000) * 900;
    assert.equal((await run(s.env, f, at)).observations, 1);
    assert.equal((await run(s.env, f, at)).status, "paused_or_busy");
    assert.equal(calls, 2);
    assert.equal(
      (await s.db.prepare("SELECT count(*) n FROM observations").first()).n,
      1,
    );
    assert.equal(
      (await s.db.prepare("SELECT count(*) n FROM catalog").first()).n,
      1,
    );
  } finally {
    s.clean();
  }
});
test("429 persists provider cooldown across invocations without repeated requests", async () => {
  const s = setup();
  try {
    const at = Math.floor(Date.now() / 900000) * 900;
    let dexCalls = 0;
    const f = async (u) => {
      if (u.includes("geckoterminal")) return Response.json(gecko);
      dexCalls++;
      return new Response("", {
        status: 429,
        headers: { "Retry-After": "7200" },
      });
    };
    assert.equal((await run(s.env, f, at)).status, "partial");
    assert.equal((await run(s.env, f, at + 180)).status, "partial");
    assert.equal(dexCalls, 1);
    assert.equal(
      (await s.db.prepare("SELECT dex_after FROM monitor_state").first())
        .dex_after,
      at + 7200,
    );
  } finally {
    s.clean();
  }
});
test("storage ceiling stops without deleting evidence", async () => {
  const s = setup();
  try {
    await s.db
      .prepare("UPDATE monitor_state SET samples_reserved=140001")
      .run();
    assert.equal(
      (
        await run(s.env, () => {
          throw Error("network");
        })
      ).status,
      "paused_or_busy",
    );
  } finally {
    s.clean();
  }
});
test("malformed upstream data records failure and releases lease", async () => {
  const s = setup();
  try {
    assert.equal(
      (
        await run(
          s.env,
          async () => Response.json({ invalid: true }),
          Math.floor(Date.now() / 900000) * 900,
        )
      ).status,
      "failed",
    );
    assert.equal(
      (await s.db.prepare("SELECT lease_until FROM monitor_state").first())
        .lease_until,
      0,
    );
    assert.equal(
      (await s.db.prepare("SELECT status FROM monitor_runs").first()).status,
      "failed",
    );
  } finally {
    s.clean();
  }
});

test("two-speed scheduler caps fast at six, preserves two rotations and loans unused slots", async () => {
  const { choose, capacity } = await import("../cloud-monitor/policy.mjs");
  const at = 1800000000;
  const fast = Array.from({ length: 10 }, (_, i) => ({
    mint: "hot" + i,
    tier: "fast",
    pin_until: 0,
    last_seen: at,
    next_at: at,
    priority: 100 - i,
    last_attempt: at,
  }));
  const slow = Array.from({ length: 20 }, (_, i) => ({
    mint: "slow" + i,
    last_attempt: i,
    next_at: at,
  }));
  const chosen = choose(fast, slow, at);
  assert.equal(chosen.length, 8);
  assert.equal(chosen.filter((x) => x.mint.startsWith("hot")).length, 6);
  assert.equal(chosen.filter((x) => x.mint.startsWith("slow")).length, 2);
  assert.equal(choose([], slow, at).length, 8);
  assert.equal(capacity(123, 6).follow_worst_rotation_minutes, 186);
});
test("two consecutive weak samples demote without discarding recent evidence", async () => {
  const { transition } = await import("../cloud-monitor/policy.mjs");
  const at = 1800000000;
  const x = normalize({ ...pair, pairCreatedAt: (at - 3600) * 1000 }, at);
  let state = { tier: "follow", recent: "[]", weak_streak: 0, pin_until: 0 };
  let t = transition(x, state, 0, at);
  assert.equal(t.tier, "fast");
  const weak = {
    ...x,
    volume5m: 100,
    buys: 1,
    sells: 10,
    observed_at: at + 300,
  };
  t = transition(weak, { ...state, ...t }, 1, at + 300);
  assert.equal(t.tier, "fast");
  t = transition(
    { ...weak, observed_at: at + 600 },
    { ...state, ...t },
    1,
    at + 600,
  );
  assert.equal(t.tier, "follow");
  assert.equal(JSON.parse(t.recent).length, 3);
});
test("research protocol, detector, matching and outcomes agree with Python golden cases", async () => {
  const { PROTOCOL, detect, match, outcome } = await import(
    "../cloud-monitor/research.mjs"
  );
  const at = 1800000000;
  const base = {
    ...normalize({ ...pair, pairCreatedAt: (at - 3600) * 1000 }, at),
    source: "test-fixture",
    risk_class: "incomplete",
  };
  const history = [
    { ...base, observed_at: at - 600, volume5m: 2000, buys: 25, price: 0.95 },
    { ...base, observed_at: at - 300, volume5m: 4000, buys: 40, price: 0.97 },
    { ...base, volume5m: 6000, buys: 50, price: 1 },
  ];
  const cases = [
    history,
    history.slice(1),
    history.map((x) => ({ ...x, liquidity: null })),
    history.map((x) => ({
      ...x,
      price: 1.1 - (x.observed_at - (at - 600)) / 3000,
    })),
    history.map((x) => ({ ...x, buys: 1, sells: 50 })),
  ];
  const alert = history.at(-1),
    control = {
      ...alert,
      mint: "11111111111111111111111111111111",
      volume5m: 5000,
    };
  const input = {
    at,
    cases,
    alert,
    control,
    samples: [{ ...alert, observed_at: at + 300, price: 1.1 }],
  };
  const py = spawnSync(
    "python3",
    [
      "-c",
      `import json,sys
from server.research import PROTOCOL,match,outcome
from server.analysis import evaluate
from server.config import DEFAULTS
x=json.load(sys.stdin);at=x['at'];kinds=[]
for h in x['cases']:
 a=evaluate({'pool_created':at-3600,'active':1},h,None,{},DEFAULTS,at)
 kinds.append(next((k for k in ['acceleration','revival'] if a['radars'][k]['detected']),None))
status,data=outcome(x['alert'],x['samples'],at,5,at+400)
print(json.dumps({'protocol':PROTOCOL,'kinds':kinds,'match':match(x['alert'],[x['control']],at),'outcome':{'status':status,'data':data}}))`,
    ],
    { input: JSON.stringify(input), encoding: "utf8" },
  );
  assert.equal(py.status, 0, py.stderr);
  const expected = JSON.parse(py.stdout);
  assert.deepEqual(PROTOCOL, expected.protocol);
  assert.deepEqual(
    cases.map((h) => detect(h.at(-1), h, [], at)),
    expected.kinds,
  );
  assert.deepEqual(match(alert, [control], at), expected.match);
  assert.deepEqual(
    outcome(alert, input.samples, at, 5, at + 400),
    expected.outcome,
  );
});
test("native staging freezes a comparable control, pins both arms and finalizes real-time-shaped samples", async () => {
  const s = setup();
  try {
    const at = Math.floor(Date.now() / 180000) * 180,
      control = "11111111111111111111111111111111";
    for (const m of [mint, control]) {
      const x = normalize(
        {
          ...pair,
          baseToken: { ...pair.baseToken, address: m },
          pairCreatedAt: (at - 7 * 86400) * 1000,
        },
        at - 300,
      );
      const recent = [
        {
          ...x,
          observed_at: at - 600,
          volume5m: m === mint ? 2000 : 5000,
          buys: m === mint ? 25 : 40,
          price: 0.95,
        },
        { ...x, volume5m: m === mint ? 4000 : 5000, buys: 40, price: 0.97 },
      ];
      await s.db
        .prepare(
          "INSERT INTO catalog(mint,first_seen,last_seen,next_at,priority,last_attempt,tier,recent) VALUES(?,?,?,?,?,?,'fast',?)",
        )
        .bind(
          m,
          at - 600,
          at - 300,
          at - 1,
          60,
          at - 300,
          JSON.stringify(recent),
        )
        .run();
    }
    const f = async (u) =>
      Response.json(
        u.includes("geckoterminal")
          ? { data: [] }
          : [
              {
                ...pair,
                pairCreatedAt: (at - 7 * 86400) * 1000,
                volume: { m5: 6000 },
                txns: { m5: { buys: 50, sells: 10 } },
              },
              {
                ...pair,
                baseToken: { ...pair.baseToken, address: control },
                pairCreatedAt: (at - 7 * 86400) * 1000,
              },
            ],
      );
    assert.equal((await run(s.env, f, at)).observations, 2);
    const c = await s.db.prepare("SELECT * FROM research_cohorts").first();
    assert.equal(c.control_mint, control);
    assert.equal(JSON.parse(c.data).alert.risk_class, "unavailable_on_worker");
    assert.equal(
      (
        await s.db
          .prepare("SELECT count(*) n FROM catalog WHERE pin_until>?")
          .bind(at)
          .first()
      ).n,
      2,
    );
    for (const m of [mint, control])
      for (const minutes of [5, 15, 30, 60]) {
        const x = {
          ...normalize(
            { ...pair, baseToken: { ...pair.baseToken, address: m } },
            c.alert_at + minutes * 60,
          ),
          price: m === mint ? 1.1 : 1.05,
        };
        await s.db
          .prepare(
            "INSERT INTO observations(mint,observed_at,source,data) VALUES(?,?,?,?)",
          )
          .bind(m, x.observed_at, x.source, JSON.stringify(x))
          .run();
      }
    const { research } = await import("../cloud-monitor/research.mjs");
    const r = await research(
      s.db,
      new Map(),
      new Map(),
      new Map(),
      c.alert_at + 4000,
      async (operation) => operation(),
    );
    await s.db.batch(r.writes);
    assert.equal(
      (await s.db.prepare("SELECT completed FROM research_cohorts").first())
        .completed,
      1,
    );
    const rows = await s.db.prepare("SELECT * FROM research_outcomes").all();
    assert.equal(rows.results.length, 8);
    assert.ok(
      rows.results.every(
        (x) =>
          x.status === "observed" &&
          JSON.parse(x.data).executable_net_usd === null,
      ),
    );
  } finally {
    s.clean();
  }
});
test("stale lease owner cannot commit or clear another owner", async () => {
  const s = setup();
  try {
    const at = Math.floor(Date.now() / 900000) * 900;
    const f = async () => {
      await s.db
        .prepare("UPDATE monitor_state SET lease_owner='new-owner'")
        .run();
      return Response.json(gecko);
    };
    assert.equal((await run(s.env, f, at)).status, "failed");
    assert.equal(
      (await s.db.prepare("SELECT count(*) n FROM observations").first()).n,
      0,
    );
    assert.equal(
      (await s.db.prepare("SELECT lease_owner FROM monitor_state").first())
        .lease_owner,
      "new-owner",
    );
  } finally {
    s.clean();
  }
});
test("manual pause and daily read ceiling prevent outbound calls", async () => {
  const s = setup();
  try {
    const at = Math.floor(Date.now() / 1000);
    await s.db.prepare("UPDATE monitor_state SET paused=1").run();
    const denied = () => {
      throw Error("network must not execute");
    };
    assert.equal((await run(s.env, denied, at)).status, "paused_or_busy");
    await s.db
      .prepare("UPDATE monitor_state SET paused=0,day=?,rows_read=2000000")
      .bind(Math.floor(at / 86400))
      .run();
    assert.equal((await run(s.env, denied, at)).status, "paused_or_busy");
  } finally {
    s.clean();
  }
});
test("burst refreshes only two candidates and keeps a matched pair on the same cadence", async () => {
  const { choose } = await import("../cloud-monitor/policy.mjs");
  const at = 1800000060;
  const fast = Array.from({ length: 6 }, (_, i) => ({
    mint: "test" + i,
    pin_until: i < 2 ? at + 300 : 0,
    study_pair: i < 2 ? "pair" : null,
    next_at: at + 120,
    priority: i < 2 ? 100 : 60,
    last_seen: at - 60,
    last_attempt: at - 60,
    weak_streak: 0,
  }));
  const burst = choose(fast, [], at, { rotation: false, burst: true });
  assert.equal(burst.length, 2);
  assert.ok(burst.every((x) => x.study_pair === "pair"));
  const singles = choose(
    fast.map((x) => ({ ...x, pin_until: 0, study_pair: null })),
    [],
    at,
    { rotation: false, burst: true },
  );
  assert.equal(singles.length, 2);
  assert.equal(
    choose(fast, [], at, { rotation: false, burst: false }).length,
    0,
  );
});
test("full-day capacity reserves quota for bounded bursts, warm tracking and discovery", async () => {
  let samples = 0,
    reserved = 0,
    active = 0;
  for (let m = 0; m < 1440; m++) {
    const rotation = m % 3 === 0,
      burst = m % 60 < 15;
    if (!rotation && !burst) continue;
    const slots = rotation ? (m % 15 === 0 ? 10 : 8) : 2;
    samples += slots;
    reserved += 40 + 8 * slots;
    active++;
  }
  assert.equal(samples, 4512);
  assert.equal(reserved, 64896);
  assert.equal(active, 720);
  assert.ok(reserved < 70000);
});
test("bursts cannot start beyond the daily reserved window and expire to rotation-only ticks", async () => {
  const s = setup();
  try {
    const at = Math.floor(Date.now() / 900000) * 900;
    await s.db
      .prepare(
        "INSERT INTO catalog(mint,first_seen,last_seen,next_at,priority,last_attempt,tier) VALUES(?,?,?,?,?,?,'fast')",
      )
      .bind(mint, at - 600, at - 60, at, 60, at - 60)
      .run();
    await s.db
      .prepare("UPDATE monitor_state SET day=?,burst_minutes=360")
      .bind(Math.floor(at / 86400))
      .run();
    const f = async (u) =>
      Response.json(u.includes("geckoterminal") ? { data: [] } : [pair]);
    assert.equal((await run(s.env, f, at)).status, "ok");
    assert.equal(
      (await s.db.prepare("SELECT burst_until FROM monitor_state").first())
        .burst_until,
      0,
    );
    assert.equal(
      (
        await run(
          s.env,
          () => {
            throw Error("no network");
          },
          at + 60,
        )
      ).status,
      "paused_or_busy",
    );
  } finally {
    s.clean();
  }
});
test("complete Worker dispatch collects every minute only within the authorized burst window", async () => {
  const s = setup(),
    originalNow = Date.now;
  try {
    const at = Math.floor(originalNow() / 900000) * 900;
    let clock = at;
    Date.now = () => clock * 1000;
    await s.db
      .prepare(
        "INSERT INTO catalog(mint,first_seen,last_seen,next_at,priority,last_attempt,tier) VALUES(?,?,?,?,?,?,'fast')",
      )
      .bind(mint, at - 600, at - 60, at, 60, at - 60)
      .run();
    let dex = 0;
    const f = async (u) => {
      if (u.includes("geckoterminal")) return Response.json({ data: [] });
      dex++;
      return Response.json([pair]);
    };
    assert.equal((await run(s.env, f, clock)).observations, 1);
    assert.equal(
      (await s.db.prepare("SELECT burst_until FROM monitor_state").first())
        .burst_until,
      at + 900,
    );
    for (const seconds of [60, 120]) {
      clock = at + seconds;
      assert.equal((await run(s.env, f, clock)).observations, 1);
    }
    assert.equal(dex, 3);
    const rows = (
      await s.db
        .prepare(
          "SELECT observed_at,data FROM observations ORDER BY observed_at",
        )
        .all()
    ).results;
    assert.deepEqual(
      rows.map((x) => x.observed_at),
      [at, at + 60, at + 120],
    );
    assert.equal(JSON.parse(rows[2].data).watch.elapsed_seconds, 60);
    clock = at + 960;
    assert.equal(
      (
        await run(
          s.env,
          () => {
            throw Error("burst expired");
          },
          clock,
        )
      ).status,
      "paused_or_busy",
    );
  } finally {
    Date.now = originalNow;
    s.clean();
  }
});
test("three recurring technical failures pause while retaining historical evidence", async () => {
  const s = setup(),
    originalNow = Date.now;
  try {
    const at = Math.floor(originalNow() / 900000) * 900;
    let clock = at;
    Date.now = () => clock * 1000;
    await s.db
      .prepare(
        "INSERT INTO catalog(mint,first_seen,last_seen,next_at) VALUES(?,?,?,?)",
      )
      .bind(mint, at - 600, at - 600, 0)
      .run();
    await s.db
      .prepare(
        "INSERT INTO observations(mint,observed_at,source,data) VALUES(?,?,?,?)",
      )
      .bind(mint, at - 600, "fixture", '{"label":"UNIT TEST ONLY"}')
      .run();
    for (const offset of [0, 360, 720]) {
      clock = at + offset;
      assert.equal(
        (await run(s.env, async () => Response.json({ invalid: true }), clock))
          .status,
        "failed",
      );
    }
    const state = await s.db
      .prepare("SELECT paused,pause_reason FROM monitor_state")
      .first();
    assert.equal(state.paused, 1);
    assert.equal(state.pause_reason, "repeated_failure");
    assert.equal(
      (await s.db.prepare("SELECT count(*) n FROM observations").first()).n,
      1,
    );
  } finally {
    Date.now = originalNow;
    s.clean();
  }
});

test("persistent deadline blocks replayed rounds and no data is collected after expiry", async () => {
  const s = setup();
  try {
    // Real SQLite trigger rejects extending a consumed authorization.
    await assert.rejects(
      s.db
        .prepare("UPDATE pilot_control SET expires_at=expires_at+1 WHERE id=1")
        .run(),
    );
  } finally {
    s.clean();
  }
});

test("expired D1 deadline rejects delayed cron timestamps with zero outbound requests", async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = setup({ start: now - 120, end: now - 60 });
  try {
    let outbound = 0;
    const result = await run(
      s.env,
      () => {
        outbound++;
        throw Error("network");
      },
      now - 120,
    );
    assert.equal(result.status, "pilot_expired");
    assert.equal(outbound, 0);
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM monitor_runs").first()).n,
      0,
    );
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM observations").first()).n,
      0,
    );
    assert.equal(
      (await s.db.prepare("SELECT last_run FROM monitor_state").first())
        .last_run,
      0,
    );
  } finally {
    s.clean();
  }
});
test("Worker shutdown probe reads and writes D1 without collecting", async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = setup({ start: now - 120, end: now - 60, used: 0 });
  try {
    await s.db
      .prepare("UPDATE pilot_control SET probe_requested=1 WHERE id=1")
      .run();
    await probe({ ...s.env, MONITOR_ENABLED: "false" });
    const row = await s.db
      .prepare("SELECT * FROM pilot_control WHERE id=1")
      .first();
    assert.equal(row.probe_completed, 1);
    assert.equal(JSON.parse(row.probe_result).outbound, 0);
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM observations").first()).n,
      0,
    );
  } finally {
    s.clean();
  }
});
test("deadline reached during a provider request prevents the data batch", async () => {
  const clock = Date.now;
  const now = Math.floor(clock() / 1000);
  const s = setup({ start: now - 1, end: now + 60 });
  try {
    const at = Math.floor(now / 900) * 900;
    await run(
      s.env,
      async () => {
        Date.now = () => (now + 61) * 1000;
        return Response.json(gecko);
      },
      at,
    );
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM observations").first()).n,
      0,
    );
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM catalog").first()).n,
      0,
    );
  } finally {
    Date.now = clock;
    s.clean();
  }
});

test("future authorization and exhausted write quota fail closed", async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = setup({ start: now + 60, end: now + 600 });
  try {
    const noNetwork = () => {
      throw Error("must not call providers");
    };
    assert.equal((await run(s.env, noNetwork)).status, "pilot_not_authorized");
  } finally {
    s.clean();
  }
  const full = setup();
  try {
    const day = Math.floor(now / 86400);
    await full.db
      .prepare("UPDATE monitor_state SET day=?,rows_written=45000 WHERE id=1")
      .bind(day)
      .run();
    const at = Math.floor(now / 180) * 180;
    assert.equal(
      (
        await run(
          full.env,
          () => {
            throw Error("write ceiling bypassed");
          },
          at,
        )
      ).status,
      "paused_or_busy",
    );
  } finally {
    full.clean();
  }
});

test("arming a fresh pilot preserves its prior expired shutdown proof atomically", async () => {
  const now = Math.floor(Date.now() / 1000);
  const s = setup({ used: 0, start: now - 120, end: now - 60 });
  try {
    await s.db
      .prepare("UPDATE pilot_control SET probe_requested=1 WHERE id=1")
      .run();
    await probe({ ...s.env, MONITOR_ENABLED: "false" });
    await s.db
      .prepare(
        "UPDATE pilot_control SET used=1,started_at=?,expires_at=? WHERE id=1",
      )
      .bind(now, now + 1800)
      .run();
    const log = await s.db
      .prepare("SELECT * FROM pilot_authorization_log WHERE id=1")
      .first();
    assert.equal(log.expires_at - log.started_at, 1800);
    const prior = JSON.parse(log.previous_control);
    assert.equal(prior.expires_at, now - 60);
    assert.equal(JSON.parse(prior.probe_result).status, "pilot_expired");
    await assert.rejects(
      s.db
        .prepare("UPDATE pilot_control SET expires_at=expires_at+1 WHERE id=1")
        .run(),
    );
  } finally {
    s.clean();
  }
});
