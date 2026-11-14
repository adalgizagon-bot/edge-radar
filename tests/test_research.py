"""Prospective statistical mechanics. Fixtures here are never market evidence."""

import copy
import unittest
from server.db import connect, ingest, dump
from server import research, tracking
from server.collector import assessment
from test_engine import AT, MINT, sample, samples

CONTROL = "11111111111111111111111111111111"


class ResearchTests(unittest.TestCase):
    def setUp(self):
        self.db = connect(":memory:")
        ingest(self.db, samples(), AT)
        ingest(self.db, [dict(sample(AT), mint=CONTROL, volume5m=5000)], AT)
        tracking.initialize(self.db)
        research.initialize(self.db)

    def tearDown(self):
        self.db.close()

    def test_frozen_contemporaneous_pair_and_later_alert_not_removed(self):
        results = {m: assessment(self.db, m, AT) for m in [MINT, CONTROL]}
        tracking.record(self.db, MINT, results[MINT], AT)
        research.enroll(self.db, results, AT)
        row = self.db.execute("SELECT * FROM research_cohorts").fetchone()
        self.assertEqual(row["control_mint"], CONTROL)
        frozen = row["data"]
        self.db.execute(
            "INSERT INTO signals(mint,kind,observed_at,price_observed_at,price,source,pool,evidence) VALUES(?,?,?,?,?,?,?,?)",
            (
                CONTROL,
                "acceleration",
                AT + 60,
                AT + 60,
                1,
                "test-fixture",
                "test-pool",
                "{}",
            ),
        )
        for mint, price in [(MINT, 1.1), (CONTROL, 1.05)]:
            ingest(self.db, [dict(sample(AT + 300, price=price), mint=mint)], AT + 300)
        research.evaluate(self.db, AT + 300)
        report = research.report(self.db)
        five = next(x for x in report["groups"] if x["horizon"] == 5)
        self.assertEqual(five["paired_observed"], 1)
        self.assertEqual(five["contaminated_controls"], 1)
        self.assertAlmostEqual(five["mean_excess_return_pct"], 5)
        self.assertIsNone(five["ci95_day_block"])
        self.assertEqual(
            self.db.execute("SELECT data FROM research_cohorts").fetchone()[0], frozen
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM tracking WHERE pin_until>?", (AT,)
            ).fetchone()[0],
            2,
        )

    def test_future_stale_unknown_and_already_alerting_controls_are_rejected(self):
        alert = dict(sample(), risk_class="incomplete")
        valid = dict(alert, mint=CONTROL, volume5m=5000)
        self.assertEqual(research.match(alert, [valid], AT)["mint"], CONTROL)
        for changed in [
            dict(observed_at=AT + 1),
            dict(observed_at=AT - 301),
            dict(has_alert=True),
            dict(pool_created=None),
            dict(liquidity=1),
            dict(risk_class="checked"),
        ]:
            self.assertIsNone(research.match(alert, [dict(valid, **changed)], AT))

    def test_missing_outcomes_remain_and_no_executable_profit_is_invented(self):
        baseline = sample()
        state, x = research.outcome(
            baseline,
            [
                sample(AT + 300, price=1.1, liquidity=None),
                sample(AT + 301, source="different", price=100),
            ],
            AT,
            5,
            AT + 400,
        )
        self.assertEqual(state, "observed")
        self.assertAlmostEqual(x["gross_return_pct"], 10)
        self.assertIsNone(x["endpoint_liquidity"])
        self.assertIsNone(x["executable_net_usd"])
        self.assertAlmostEqual(
            x["net_scenario_usd"], 20 * (1.1 * 0.98 / 1.02 - 1) - 0.1
        )
        state, x = research.outcome(baseline, [], AT, 15, AT + 1200)
        self.assertEqual(state, "missing")
        self.assertIsNone(x["net_scenario_usd"])

    def test_horizon_uses_frozen_costs_and_same_pool(self):
        frozen = copy.deepcopy(research.PROTOCOL)
        frozen["fee_per_side_bps"] = 0
        frozen["slippage_per_side_bps"] = 0
        frozen["network_fee_per_side_usd"] = 0
        _, x = research.outcome(
            sample(),
            [sample(AT + 300, price=1.2, pool="other")],
            AT,
            5,
            AT + 500,
            frozen,
        )
        self.assertIsNone(x["price"])
        _, x = research.outcome(
            sample(), [sample(AT + 300, price=1.2)], AT, 5, AT + 500, frozen
        )
        self.assertAlmostEqual(x["net_scenario_usd"], 4)

    def test_two_weak_new_samples_demote_without_deleting_history(self):
        r = assessment(self.db, MINT, AT)
        tracking.record(self.db, MINT, r, AT)
        self.assertEqual(
            self.db.execute(
                "SELECT tier FROM tracking WHERE mint=?", (MINT,)
            ).fetchone()[0],
            "fast",
        )
        for t in [AT + 300, AT + 600]:
            ingest(self.db, [sample(t, volume5m=500, buys=1, sells=10)], t)
            tracking.record(self.db, MINT, assessment(self.db, MINT, t), t)
            # Reprocessing a cached observation must not count as another weak sample.
            tracking.record(self.db, MINT, assessment(self.db, MINT, t), t)
            weak = self.db.execute(
                "SELECT weak_streak FROM tracking WHERE mint=?", (MINT,)
            ).fetchone()[0]
            self.assertEqual(weak, 1 if t == AT + 300 else 2)
        self.assertEqual(
            self.db.execute(
                "SELECT tier FROM tracking WHERE mint=?", (MINT,)
            ).fetchone()[0],
            "follow",
        )
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM snapshots WHERE mint=?", (MINT,)
            ).fetchone()[0],
            5,
        )

    def test_market_classification_does_not_require_social_but_risk_stays_blocked(self):
        x = assessment(self.db, MINT, AT)["assessment"]
        self.assertIsNotNone(x["scores"]["market"])
        self.assertIsNone(x["scores"]["social"])
        self.assertNotEqual(x["state"], "validated")
        self.assertIsNone(next(c for c in x["checks"] if c["key"] == "risk")["passed"])

    def test_capacity_never_steals_pinned_reference_slots(self):
        self.db.execute(
            "UPDATE tracking SET pin_until=?,tier='fast',next_at=? WHERE mint=?",
            (AT + 3780, AT + 300, CONTROL),
        )
        selected = tracking.due(self.db, AT, 1)
        self.assertEqual(selected, [CONTROL])

    def test_unmatched_and_missing_pairs_are_in_denominator(self):
        data = {"alert": sample(), "control": None, "detector_group": "test"}
        self.db.execute(
            "INSERT INTO research_cohorts(id,alert_mint,control_mint,alert_at,protocol,data) VALUES(?,?,?,?,?,?)",
            ("test", MINT, None, AT, dump(research.PROTOCOL), dump(data)),
        )
        research.evaluate(self.db, AT + 4000)
        r = research.report(self.db)
        self.assertEqual(r["cohorts"], 1)
        self.assertTrue(
            all(
                g["cohorts"] == 1
                and g["paired_observed"] == 0
                and g["unavailable_pairs"] == 1
                for g in r["groups"]
            )
        )
        self.assertEqual(
            self.db.execute("SELECT completed FROM research_cohorts").fetchone()[0], 1
        )
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM research_outcomes").fetchone()[0], 8
        )

    def test_blind_intervals_are_unknown_not_executable_extrema(self):
        _, x = research.outcome(
            sample(), [sample(AT + 300, price=1.1)], AT, 5, AT + 400
        )
        self.assertEqual(x["between_samples"], "unknown")
        self.assertEqual(x["unsampled_intervals_seconds"], [300])
        self.assertFalse(x["continuous_extrema_known"])
        self.assertFalse(x["stop_execution_assumed"])

    def test_day_block_interval_preserves_intraday_dependence_and_primary_horizon(self):
        for day in range(20):
            for i in range(6):
                t = AT + day * 86400
                ident = f"fixture-{day}-{i}"
                data = {
                    "alert": sample(),
                    "control": dict(sample(), mint=CONTROL),
                    "detector_group": "test",
                }
                self.db.execute(
                    "INSERT INTO research_cohorts(id,alert_mint,control_mint,alert_at,protocol,data) VALUES(?,?,?,?,?,?)",
                    (ident, MINT, CONTROL, t, dump(research.PROTOCOL), dump(data)),
                )
                for role, ret in [("alert", day - 10), ("control", 0)]:
                    x = {
                        "sample_at": t + 1800,
                        "gross_return_pct": ret,
                        "net_scenario_usd": 0,
                        "max_gap_seconds": 180,
                    }
                    self.db.execute(
                        "INSERT INTO research_outcomes VALUES(?,?,?,?,?)",
                        (ident, role, 30, "observed", dump(x)),
                    )
        g = next(x for x in research.report(self.db)["groups"] if x["horizon"] == 30)
        self.assertEqual(g["paired_observed"], 120)
        self.assertEqual(g["distinct_days"], 20)
        self.assertAlmostEqual(g["mean_excess_return_pct"], -0.5)
        self.assertGreater(g["ci95_day_block"][1] - g["ci95_day_block"][0], 3)
        self.assertTrue(g["primary"])
        self.assertFalse(g["executable_profit_proven"])

    def test_offline_staging_preflight_never_authorizes_deployment(self):
        from scripts.staging_preflight import review

        r = review()
        self.assertTrue(r["safe_preparation"])
        self.assertFalse(r["database_id_configured"])
        self.assertFalse(r["deploy_authorized"])
        self.assertFalse(r["remote_cpu_validated"])

    def test_staging_seed_keeps_history_and_is_idempotent_without_alerts(self):
        import tempfile
        import sqlite3
        from pathlib import Path
        from scripts.staging_seed import generate

        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source.sqlite3"
            target = Path(folder) / "seed.sql"
            dst = sqlite3.connect(source)
            self.db.backup(dst)
            dst.close()
            summary = generate(source, target)
            dest = sqlite3.connect(":memory:")
            dest.executescript(Path("cloud-monitor/schema.sql").read_text())
            dest.executescript(target.read_text())
            dest.executescript(target.read_text())
            self.assertEqual(
                dest.execute("SELECT count(*) FROM observations").fetchone()[0],
                summary["snapshots"],
            )
            self.assertEqual(
                dest.execute("SELECT count(*) FROM catalog").fetchone()[0], 2
            )
            self.assertEqual(
                dest.execute("SELECT count(*) FROM research_cohorts").fetchone()[0], 0
            )
            self.assertEqual(
                dest.execute("SELECT min(observed_at) FROM observations").fetchone()[0],
                AT - 600,
            )
            dest.close()
            with self.assertRaises(FileExistsError):
                generate(source, target)

    def test_previous_staging_schema_migrates_without_losing_evidence(self):
        import sqlite3
        from pathlib import Path

        d = sqlite3.connect(":memory:")
        d.executescript("""CREATE TABLE monitor_state(id INTEGER PRIMARY KEY,lease_until INTEGER NOT NULL DEFAULT 0,last_run INTEGER NOT NULL DEFAULT 0,gecko_after INTEGER NOT NULL DEFAULT 0,dex_after INTEGER NOT NULL DEFAULT 0,day INTEGER NOT NULL DEFAULT 0,writes_reserved INTEGER NOT NULL DEFAULT 0,samples_reserved INTEGER NOT NULL DEFAULT 0);
        INSERT INTO monitor_state(id) VALUES(1);
        CREATE TABLE catalog(mint TEXT PRIMARY KEY,first_seen INTEGER,last_seen INTEGER,next_at INTEGER,priority INTEGER DEFAULT 0,last_attempt INTEGER DEFAULT 0);
        CREATE INDEX catalog_fair ON catalog(last_attempt);
        CREATE TABLE observations(id INTEGER PRIMARY KEY,mint TEXT,observed_at INTEGER,source TEXT,data TEXT,UNIQUE(mint,observed_at,source));
        CREATE TABLE monitor_runs(id INTEGER PRIMARY KEY,started_at INTEGER,status TEXT,data TEXT);""")
        d.execute(
            "INSERT INTO observations VALUES(1,?,?,?,?)",
            (MINT, AT, "test-fixture", dump(sample())),
        )
        d.executescript(
            Path("cloud-monitor/migrations/0003-from-stage2.sql").read_text()
        )
        self.assertEqual(
            d.execute("SELECT data FROM observations").fetchone()[0], dump(sample())
        )
        self.assertEqual(
            d.execute("SELECT purpose FROM monitor_state").fetchone()[0],
            "edge-radar-staging",
        )
        self.assertEqual(
            d.execute("SELECT count(*) FROM research_cohorts").fetchone()[0], 0
        )
        d.close()
