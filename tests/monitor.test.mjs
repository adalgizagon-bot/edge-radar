// Synthetic fixtures are test-only. Real SQLite executes the exact D1 statements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, normalize, retryAfter } from "../cloud-monitor/worker.mjs";
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
function setup() {
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
    const at = Math.floor(Date.now() / 1000);
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
    const at = Math.floor(Date.now() / 1000);
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
    assert.equal((await run(s.env, f, at + 300)).status, "partial");
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
      (await run(s.env, async () => Response.json({ invalid: true }))).status,
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
