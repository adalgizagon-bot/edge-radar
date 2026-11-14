// Synthetic fixtures are test-only. Real SQLite executes the exact D1 statements.
import { setup } from "./helpers/monitor-db.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

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
    assert.equal((await run(s.env, f, at + 180)).status, "idle");
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

test("disabled scheduled tick performs zero D1 queries without an explicit shutdown probe", async () => {
  const { default: worker } = await import("../cloud-monitor/worker.mjs");
  const waits = [];
  await worker.scheduled(
    { scheduledTime: Date.now() },
    {
      MONITOR_ENABLED: "false",
      MONITOR_DB: {
        prepare() {
          throw Error("unnecessary D1");
        },
      },
    },
    { waitUntil: (p) => waits.push(p) },
  );
  await Promise.all(waits);
});
test("empty rotation is read-only and discovery still runs at the original quarter-hour", async () => {
  const s = setup();
  const clock = Date.now,
    base = Math.floor(clock() / 900000) * 900;
  try {
    Date.now = () => (base + 180) * 1000;
    s.resetStats();
    assert.equal(
      (
        await run(
          s.env,
          () => {
            throw Error("idle network");
          },
          base + 180,
        )
      ).status,
      "idle",
    );
    assert.equal(s.stats.calls, 1);
    assert.equal(s.stats.mutations, 0);
    assert.ok(s.stats.bytes < 1000);
    assert.equal(
      (await s.db.prepare("SELECT last_run FROM monitor_state").first())
        .last_run,
      0,
    );
    let calls = 0;
    Date.now = () => (base + 900) * 1000;
    assert.equal(
      (
        await run(
          s.env,
          async (url) => {
            calls++;
            assert.ok(url.includes("geckoterminal"));
            return Response.json({ data: [] });
          },
          base + 900,
        )
      ).status,
      "ok",
    );
    assert.equal(calls, 1);
  } finally {
    Date.now = clock;
    s.clean();
  }
});
test("future cohort stays lightweight, then due missing outcomes are finalized on schedule", async () => {
  const s = setup(),
    clock = Date.now,
    base = Math.floor(clock() / 900000) * 900;
  const { PROTOCOL } = await import("../cloud-monitor/protocol.mjs");
  const x = { ...normalize(pair, base), pool_created: base - 864000 };
  try {
    await s.db
      .prepare(
        "INSERT INTO research_cohorts(id,alert_mint,control_mint,alert_at,protocol,data) VALUES('scheduled',?,?,?,?,?)",
      )
      .bind(
        mint,
        mint,
        base,
        JSON.stringify(PROTOCOL),
        JSON.stringify({ alert: x, control: x }),
      )
      .run();
    Date.now = () => (base + 180) * 1000;
    s.resetStats();
    assert.equal(
      (
        await run(
          s.env,
          () => {
            throw Error("no provider");
          },
          base + 180,
        )
      ).status,
      "idle",
    );
    assert.equal(s.stats.calls, 1);
    assert.equal(s.stats.mutations, 0);
    Date.now = () => (base + 540) * 1000;
    assert.equal(
      (
        await run(
          s.env,
          () => {
            throw Error("research-only provider");
          },
          base + 540,
        )
      ).status,
      "ok",
    );
    const rows = (
      await s.db
        .prepare(
          "SELECT role,horizon,status FROM research_outcomes ORDER BY role",
        )
        .all()
    ).results;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.horizon === 5 && x.status === "missing"));
  } finally {
    Date.now = clock;
    s.clean();
  }
});
test("unmatched statistical controls are finalized without waiting for alert horizons", async () => {
  const s = setup(),
    clock = Date.now,
    base = Math.floor(clock() / 900000) * 900;
  const { PROTOCOL } = await import("../cloud-monitor/protocol.mjs");
  try {
    const x = normalize(pair, base);
    await s.db
      .prepare(
        "INSERT INTO research_cohorts(id,alert_mint,alert_at,protocol,data) VALUES('unmatched',?,?,?,?)",
      )
      .bind(
        mint,
        base,
        JSON.stringify(PROTOCOL),
        JSON.stringify({ alert: x, control: null }),
      )
      .run();
    Date.now = () => (base + 180) * 1000;
    await run(
      s.env,
      () => {
        throw Error("no network");
      },
      base + 180,
    );
    const rows = (
      await s.db.prepare("SELECT role,status FROM research_outcomes").all()
    ).results;
    assert.equal(rows.length, 4);
    assert.ok(
      rows.every((x) => x.role === "control" && x.status === "unmatched"),
    );
  } finally {
    Date.now = clock;
    s.clean();
  }
});
test("future follow rows cannot hide a due contract beyond the old 64-row prefix", async () => {
  const s = setup(),
    clock = Date.now,
    at = Math.floor(clock() / 900000) * 900 + 180;
  try {
    for (let i = 0; i < 70; i++)
      await s.db
        .prepare(
          "INSERT INTO catalog(mint,first_seen,last_seen,next_at,last_attempt,recent) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          "future-" + i,
          at,
          at,
          at + 1800,
          0,
          JSON.stringify([{ evidence: "x".repeat(5000) }]),
        )
        .run();
    await s.db
      .prepare(
        "INSERT INTO catalog(mint,first_seen,last_seen,next_at,last_attempt) VALUES(?,?,?,?,?)",
      )
      .bind(mint, at, at, at, 1)
      .run();
    Date.now = () => at * 1000;
    s.resetStats();
    const result = await run(
      s.env,
      async (url) => {
        assert.ok(url.includes(mint));
        return Response.json([pair]);
      },
      at,
    );
    assert.equal(result.observations, 1);
    assert.ok(
      s.stats.bytes < 10000,
      "future histories should not cross the SQLite adapter",
    );
  } finally {
    Date.now = clock;
    s.clean();
  }
});

test("provider 403 pauses persistently without attempting DEX or recording observations", async () => {
  const s = setup(),
    at = Math.floor(Date.now() / 900000) * 900;
  try {
    let calls = 0;
    const result = await run(
      s.env,
      async (url) => {
        calls++;
        assert.ok(url.includes("geckoterminal"));
        return new Response("", { status: 403 });
      },
      at,
    );
    assert.equal(result.status, "partial");
    assert.equal(calls, 1);
    const state = await s.db
      .prepare("SELECT paused,pause_reason FROM monitor_state")
      .first();
    assert.equal(state.paused, 1);
    assert.equal(state.pause_reason, "provider_denied");
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM observations").first()).n,
      0,
    );
  } finally {
    s.clean();
  }
});

async function secondSession(
  s,
  {
    id = "pilot-two-test",
    start = Math.floor(Date.now() / 1000) - 1,
    end = start + 1800,
    kind = "pilot",
    activate = true,
  } = {},
) {
  const proofId = kind === "pilot" ? id + "-proof" : null;
  if (proofId) {
    const now = Math.floor(Date.now() / 1000);
    await s.db
      .prepare(
        "INSERT INTO pilot_authorizations(id,kind,started_at,expires_at,probe_requested) VALUES(?,'shutdown-test',?,?,1)",
      )
      .bind(proofId, now - 120, now - 60)
      .run();
    await probe({
      ...s.env,
      PILOT_AUTHORIZATION_ID: proofId,
      MONITOR_ENABLED: "false",
    });
  }
  await s.db
    .prepare(
      "INSERT INTO pilot_authorizations(id,kind,started_at,expires_at,shutdown_test_id) VALUES(?,?,?,?,?)",
    )
    .bind(id, kind, start, end, proofId)
    .run();
  if (activate)
    await s.db
      .prepare(
        "UPDATE pilot_authorizations SET consumed=1,activated_at=unixepoch() WHERE id=?",
      )
      .bind(id)
      .run();
  return { ...s.env, PILOT_AUTHORIZATION_ID: id };
}
test("independent authorization preserves legacy proof and cannot extend, rearm, delete or undo a stop", async () => {
  const s = setup();
  try {
    const before = await s.db.prepare("SELECT * FROM pilot_control").first();
    const env = await secondSession(s);
    for (const sql of [
      "UPDATE pilot_authorizations SET expires_at=expires_at+1",
      "UPDATE pilot_authorizations SET started_at=started_at-1",
      "UPDATE pilot_authorizations SET consumed=0,activated_at=0",
      "DELETE FROM pilot_authorizations",
    ])
      await assert.rejects(
        s.db
          .prepare(sql + " WHERE id=?")
          .bind(env.PILOT_AUTHORIZATION_ID)
          .run(),
      );
    await s.db
      .prepare(
        "UPDATE pilot_authorizations SET stopped_at=unixepoch(),stop_reason='test-stop' WHERE id=?",
      )
      .bind(env.PILOT_AUTHORIZATION_ID)
      .run();
    await assert.rejects(
      s.db
        .prepare(
          "UPDATE pilot_authorizations SET stopped_at=0,stop_reason=NULL WHERE id=?",
        )
        .bind(env.PILOT_AUTHORIZATION_ID)
        .run(),
    );
    assert.equal(
      (
        await run(env, () => {
          throw Error("stopped network");
        })
      ).status,
      "pilot_not_authorized",
    );
    assert.deepEqual(
      await s.db.prepare("SELECT * FROM pilot_control").first(),
      before,
    );
  } finally {
    s.clean();
  }
});
test("new pending, missing and expired session identities never fall back to a live legacy authorization", async () => {
  const s = setup(),
    now = Math.floor(Date.now() / 1000);
  try {
    const env = await secondSession(s, {
      start: now + 600,
      end: now + 1800,
      activate: false,
    });
    await assert.rejects(
      s.db
        .prepare(
          "UPDATE pilot_authorizations SET consumed=1,activated_at=unixepoch() WHERE id=?",
        )
        .bind(env.PILOT_AUTHORIZATION_ID)
        .run(),
    );
    await assert.rejects(
      s.db
        .prepare(
          "INSERT INTO pilot_authorizations(id,kind,started_at,expires_at) VALUES('too-long','pilot',?,?)",
        )
        .bind(now, now + 1801)
        .run(),
    );
    assert.equal(
      (
        await run(env, () => {
          throw Error("pending network");
        })
      ).status,
      "pilot_not_authorized",
    );
    assert.equal(
      (
        await run({ ...env, PILOT_AUTHORIZATION_ID: "does-not-exist" }, () => {
          throw Error("fallback network");
        })
      ).status,
      "pilot_not_authorized",
    );
    const expired = await secondSession(s, {
      id: "expired-new",
      start: now - 120,
      end: now - 60,
      activate: false,
      kind: "shutdown-test",
    });
    assert.equal(
      (
        await run(expired, () => {
          throw Error("expired network");
        })
      ).status,
      "pilot_expired",
    );
    await s.db
      .prepare(
        "UPDATE pilot_authorizations SET probe_requested=1 WHERE id='expired-new'",
      )
      .run();
    await probe({ ...expired, MONITOR_ENABLED: "false" });
    const proof = await s.db
      .prepare("SELECT * FROM pilot_authorizations WHERE id='expired-new'")
      .first();
    assert.equal(JSON.parse(proof.probe_result).outbound, 0);
    assert.equal(proof.probe_completed, 1);
    await assert.rejects(
      s.db
        .prepare(
          "UPDATE pilot_authorizations SET consumed=1,activated_at=unixepoch() WHERE id='expired-new'",
        )
        .run(),
    );
  } finally {
    s.clean();
  }
});
test("independent authorization supports discovery and permanent stop rolls back an in-flight data batch", async () => {
  const s = setup(),
    at = Math.floor(Date.now() / 900000) * 900;
  try {
    const env = await secondSession(s);
    const result = await run(
      env,
      async (url) => {
        if (url.includes("geckoterminal")) return Response.json(gecko);
        await s.db
          .prepare(
            "UPDATE pilot_authorizations SET stopped_at=unixepoch(),stop_reason='operator-stop' WHERE id=?",
          )
          .bind(env.PILOT_AUTHORIZATION_ID)
          .run();
        return Response.json([pair]);
      },
      at,
    );
    assert.equal(result.status, "failed");
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM observations").first()).n,
      0,
    );
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM catalog").first()).n,
      0,
    );
    assert.equal(
      (
        await run(
          env,
          () => {
            throw Error("must stay stopped");
          },
          at + 180,
        )
      ).status,
      "pilot_not_authorized",
    );
  } finally {
    s.clean();
  }
});
test("independent authorization honours a persistent pause and expiration during real elapsed response time", async () => {
  const s = setup(),
    at = Math.floor(Date.now() / 900000) * 900;
  const { setTimeout: delay } = await import("node:timers/promises");
  try {
    const now = Math.floor(Date.now() / 1000);
    const env = await secondSession(s, { start: now - 1798, end: now + 2 });
    await s.db
      .prepare("UPDATE monitor_state SET paused=1,pause_reason='manual'")
      .run();
    assert.equal(
      (
        await run(
          env,
          () => {
            throw Error("paused network");
          },
          at,
        )
      ).status,
      "paused_or_busy",
    );
    await s.db
      .prepare("UPDATE monitor_state SET paused=0,pause_reason=NULL")
      .run();
    await run(
      env,
      async () => {
        await delay(2200);
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
    assert.equal(
      (
        await run(
          env,
          () => {
            throw Error("expired round");
          },
          at + 180,
        )
      ).status,
      "pilot_expired",
    );
  } finally {
    s.clean();
  }
});

test("independent real-pilot path persists observations only after its shutdown proof", async () => {
  const s = setup(),
    at = Math.floor(Date.now() / 900000) * 900;
  try {
    const env = await secondSession(s);
    const result = await run(
      env,
      async (url) =>
        Response.json(url.includes("geckoterminal") ? gecko : [pair]),
      at,
    );
    assert.equal(result.observations, 1);
    assert.equal(
      (await s.db.prepare("SELECT count(*) AS n FROM observations").first()).n,
      1,
    );
    await assert.rejects(
      s.db
        .prepare(
          "UPDATE pilot_authorizations SET probe_result='{}' WHERE kind='shutdown-test'",
        )
        .run(),
    );
    const now = Math.floor(Date.now() / 1000);
    await s.db
      .prepare(
        "INSERT INTO pilot_authorizations(id,kind,started_at,expires_at) VALUES('unproven','pilot',?,?)",
      )
      .bind(now - 1, now + 1799)
      .run();
    await assert.rejects(
      s.db
        .prepare(
          "UPDATE pilot_authorizations SET consumed=1,activated_at=unixepoch() WHERE id='unproven'",
        )
        .run(),
    );
  } finally {
    s.clean();
  }
});
