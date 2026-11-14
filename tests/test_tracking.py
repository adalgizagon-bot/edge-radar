"""Synthetic inputs are isolated tests, never market evidence."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import urllib.error
from email.utils import formatdate
from server.db import connect, ingest, load, dump
from server.tracking import initialize, due, attempted, record, outcomes
from server.sources import HTTP, SourceError
from server.collector import assessment
from test_engine import sample, AT, MINT, samples


class TrackingTests(unittest.TestCase):
    def setUp(self):
        self.db = connect(":memory:")
        ingest(self.db, samples(), AT)
        initialize(self.db)

    def tearDown(self):
        self.db.close()

    def test_archive_remains_due_and_no_duplicate_queue(self):
        self.db.execute("UPDATE tokens SET active=0")
        initialize(self.db)
        self.assertIn(MINT, due(self.db, AT))
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM tracking").fetchone()[0], 1
        )

    def test_gap_closed_only_by_new_observation_and_survives_reopen(self):
        attempted(self.db, [MINT], [], AT + 900)
        attempted(self.db, [MINT], [], AT + 1200)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM sampling_gaps").fetchone()[0], 1
        )
        attempted(self.db, [MINT], [sample(AT + 1300)], AT + 1300)
        self.assertEqual(
            self.db.execute("SELECT ended_at FROM sampling_gaps").fetchone()[0],
            AT + 1300,
        )
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "history.sqlite3")
            dst = connect(path)
            self.db.backup(dst)
            dst.close()
            dst = connect(path)
            self.assertEqual(
                dst.execute("SELECT count(*) FROM snapshots").fetchone()[0], 3
            )
            self.assertEqual(
                dst.execute("SELECT count(*) FROM tracking").fetchone()[0], 1
            )
            dst.close()

    def test_signal_uses_alert_time_and_original_price_time_no_backfill(self):
        with patch("server.collector.now", return_value=AT + 30):
            x = assessment(self.db, MINT, AT + 30)
        record(self.db, MINT, x, AT + 30)
        record(self.db, MINT, x, AT + 40)
        s = self.db.execute("SELECT * FROM signals").fetchone()
        self.assertEqual(s["observed_at"], AT + 30)
        self.assertEqual(s["price_observed_at"], AT)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM signals").fetchone()[0], 1
        )
        outcomes(self.db, AT + 60)
        self.assertTrue(
            all(
                r[0] == "pending"
                for r in self.db.execute("SELECT status FROM signal_outcomes")
            )
        )
        ingest(
            self.db,
            [
                sample(AT + 330, price=1.1, liquidity=30000),
                sample(AT + 400, price=100, source="different"),
            ],
            AT + 400,
        )
        outcomes(self.db, AT + 400)
        r = self.db.execute("SELECT * FROM signal_outcomes WHERE horizon=5").fetchone()
        self.assertEqual(r["status"], "observed")
        self.assertAlmostEqual(load(r["data"])["change_pct"], 10)
        outcomes(self.db, AT + 4000)
        self.assertEqual(
            self.db.execute(
                "SELECT count(*) FROM signal_outcomes WHERE status='missing'"
            ).fetchone()[0],
            3,
        )

    def test_stale_data_never_creates_acceleration(self):
        x = assessment(self.db, MINT, AT + 3600)
        self.assertEqual(x["assessment"]["freshness"]["status"], "stale")
        self.assertFalse(x["assessment"]["radars"]["acceleration"]["detected"])
        record(self.db, MINT, x, AT + 3600)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM signals").fetchone()[0], 0
        )

    def test_retry_after_numeric_and_date_not_capped_shared_across_clients(self):
        for header in ["7200", formatdate(AT + 7200, usegmt=True)]:
            self.db.execute("DELETE FROM source_state")
            err = urllib.error.HTTPError(
                "https://unit-test.invalid",
                429,
                "rate limited",
                {"Retry-After": header},
                None,
            )
            with (
                patch("server.sources.now", return_value=AT),
                patch("urllib.request.urlopen", side_effect=err) as fetch,
            ):
                with self.assertRaises(SourceError):
                    HTTP(self.db).request(
                        "solana_rpc",
                        "https://unit-test.invalid",
                        body={"method": "getAccountInfo"},
                    )
                self.assertGreaterEqual(
                    self.db.execute("SELECT next_attempt FROM source_state").fetchone()[
                        0
                    ],
                    AT + 7200,
                )
                with self.assertRaises(SourceError):
                    HTTP(self.db).request(
                        "solana_rpc",
                        "https://unit-test.invalid",
                        body={"method": "getTokenLargestAccounts"},
                    )
                self.assertEqual(fetch.call_count, 1)

    def test_global_budget_blocks_before_network(self):
        self.db.execute(
            "CREATE TABLE request_budget(day INTEGER PRIMARY KEY,requests INTEGER NOT NULL)"
        )
        self.db.execute("INSERT INTO request_budget VALUES(?,6000)", (AT // 86400,))
        with (
            patch("server.sources.now", return_value=AT),
            patch("urllib.request.urlopen") as fetch,
        ):
            with self.assertRaises(SourceError):
                HTTP(self.db).request("test", "https://unit-test.invalid")
            fetch.assert_not_called()

    def test_promising_priority_keeps_fair_rotation(self):
        for i in range(100):
            mint = "synthetic-test-contract-" + str(i)
            ingest(self.db, [dict(sample(), mint=mint)], AT)
        initialize(self.db)
        self.db.execute(
            "UPDATE tracking SET priority=100,tier='fast',last_attempt=? WHERE mint=?",
            (AT - 600, MINT),
        )
        selected = due(self.db, AT, 60)
        self.assertEqual(len(selected), 60)
        self.assertIn(MINT, selected)
        self.assertEqual(len(set(selected)), 60)

    def test_gap_prevents_false_consistency(self):
        from server.analysis import evaluate
        from test_engine import TOKEN, SEC, SOC
        from server.config import DEFAULTS

        rows = [
            sample(AT - 1800, volume5m=1000),
            sample(AT - 300, volume5m=3000),
            sample(AT),
        ]
        x = evaluate(TOKEN, rows, SEC, SOC, DEFAULTS, AT)
        self.assertFalse(x["radars"]["acceleration"]["detected"])
        self.assertEqual(x["history_status"]["acceleration"], "insufficient")

    def test_persistent_runner_refuses_missing_history(self):
        from scripts.run_persistent import validate_database

        with self.assertRaises(ValueError):
            validate_database(None)
        with self.assertRaises(ValueError):
            validate_database("/not-a-real-mount/history.sqlite3")

    def test_d1_import_preserves_timestamps_without_retroactive_signals(self):
        import sqlite3
        from scripts.import_monitor import import_export

        with tempfile.TemporaryDirectory() as folder:
            source = str(Path(folder) / "d1.sqlite3")
            target = str(Path(folder) / "analysis.sqlite3")
            d = sqlite3.connect(source)
            d.executescript(Path("cloud-monitor/schema.sql").read_text())
            d.execute(
                "INSERT INTO observations(mint,observed_at,source,data) VALUES(?,?,?,?)",
                (MINT, AT, "test-fixture", dump(sample())),
            )
            d.commit()
            d.close()
            with patch("scripts.import_monitor.now", return_value=AT + 100):
                self.assertEqual(import_export(source, target), 1)
            d = connect(target)
            self.assertEqual(
                d.execute("SELECT observed_at FROM snapshots").fetchone()[0], AT
            )
            self.assertEqual(
                d.execute("SELECT first_seen FROM tokens").fetchone()[0], AT
            )
            self.assertEqual(d.execute("SELECT count(*) FROM signals").fetchone()[0], 0)
            d.close()
            with self.assertRaises(ValueError):
                import_export(source, target)

    def test_partial_audit_retains_authorities_when_concentration_fails(self):
        from server.sources import Security

        class PartialRPC:
            last_observed_at = AT

            def request(self, provider, url, **kwargs):
                if kwargs["body"]["method"] == "getTokenLargestAccounts":
                    raise SourceError("solana_rpc: HTTP 429")
                return {
                    "result": {
                        "value": {
                            "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                            "data": {
                                "parsed": {
                                    "type": "mint",
                                    "info": {
                                        "supply": "1000000",
                                        "decimals": 6,
                                        "mintAuthority": None,
                                        "freezeAuthority": None,
                                    },
                                }
                            },
                        }
                    }
                }

        x = Security(PartialRPC()).inspect(MINT)
        self.assertFalse(x["complete"])
        self.assertIsNone(x["mint_authority"])
        self.assertEqual(x["checks"]["mint_authority"]["status"], "observed")
        self.assertEqual(x["checks"]["largest_accounts"]["status"], "missing")
        self.assertIn("429", x["checks"]["largest_accounts"]["error"])

    def test_inflight_provider_request_is_deferred(self):
        h = HTTP(self.db)
        self.db.execute(
            "INSERT INTO http_inflight VALUES(?,?)", ("solana_rpc", AT + 20)
        )
        with (
            patch("server.sources.now", return_value=AT),
            patch("urllib.request.urlopen") as fetch,
        ):
            with self.assertRaises(SourceError):
                h.request("solana_rpc", "https://unit-test.invalid")
            fetch.assert_not_called()
