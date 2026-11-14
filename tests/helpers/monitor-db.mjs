import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
export function setup(options = {}) {
  const folder = mkdtempSync(join(tmpdir(), "edge-monitor-"));
  const path = join(folder, "test.sqlite3");
  const schema = readFileSync(
    new URL("../../cloud-monitor/schema.sql", import.meta.url),
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
  const stats = {
    calls: 0,
    statements: 0,
    mutations: 0,
    rows: 0,
    bytes: 0,
    adapterCpuUs: 0,
    sql: [],
  };
  const execute = (statements) => {
    const cpu = process.cpuUsage();
    const p = spawnSync("python3", ["tests/monitor_sqlite_bridge.py"], {
      input: JSON.stringify({ path, statements }),
      encoding: "utf8",
    });
    assert.equal(p.status, 0, p.stderr);
    const result = JSON.parse(p.stdout);
    const used = process.cpuUsage(cpu);
    stats.adapterCpuUs += used.user + used.system;
    stats.calls++;
    stats.statements += statements.length;
    stats.sql.push(...statements.map((s) => s.sql));
    for (const r of result) {
      stats.mutations += r.meta.changes;
      stats.rows += r.results.length;
      stats.bytes += Buffer.byteLength(JSON.stringify(r.results));
    }
    return result;
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
    stats,
    resetStats: () => {
      for (const k of Object.keys(stats)) stats[k] = k === "sql" ? [] : 0;
    },
    env: { MONITOR_ENABLED: "true", MONITOR_DB: db },
    clean: () => rmSync(folder, { recursive: true, force: true }),
  };
}
