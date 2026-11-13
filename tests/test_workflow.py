"""Prospective synthetic integration tests; none of this data is imported by runtime."""

import copy
import json
import threading
import tempfile
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch, MagicMock
from http.server import ThreadingHTTPServer
from server.app import Handler
from server.db import connect, history, ingest, now
from server.collector import collect, assessment
from server.sources import HTTP
from test_engine import MINT, AT, sample


class WorkflowTests(unittest.TestCase):
    def test_progressive_collection_creates_acceleration_not_backfill(self):
        class Provider:
            remaining = 24
            step = 0

            def request(self, provider, url, **kwargs):
                if "token-profiles" in url:
                    return [{"chainId": "solana", "tokenAddress": MINT}]
                if "/tokens/v1/" in url:
                    return [
                        {
                            "chainId": "solana",
                            "baseToken": {
                                "address": MINT,
                                "name": "TEST FIXTURE ONLY",
                                "symbol": "TEST",
                            },
                            "pairAddress": "test-pool",
                            "pairCreatedAt": (AT - 3600) * 1000,
                            "priceUsd": str(1 + self.step * 0.01),
                            "liquidity": {"usd": 50000},
                            "volume": {"m5": 2000 + self.step * 2000},
                            "txns": {"m5": {"buys": 20 + self.step * 15, "sells": 10}},
                            "priceChange": {"m5": 3},
                        }
                    ]
                if "getAccountInfo" == kwargs.get("body", {}).get("method"):
                    return {
                        "result": {
                            "value": {
                                "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                                "data": {
                                    "parsed": {
                                        "type": "mint",
                                        "info": {
                                            "supply": "100000",
                                            "decimals": 6,
                                            "mintAuthority": None,
                                            "freezeAuthority": None,
                                        },
                                    }
                                },
                            }
                        }
                    }
                if "getTokenLargestAccounts" == kwargs.get("body", {}).get("method"):
                    return {"result": {"value": [{"amount": "5000"}]}}
                if provider == "bluesky":
                    return {"posts": []}
                return {"data": [], "included": []}

        db = connect(":memory:")
        p = Provider()
        for step in range(3):
            p.step = step
            at = AT + step * 360
            with (
                patch("server.collector.now", return_value=at),
                patch("server.sources.now", return_value=at),
            ):
                result = collect(db, p)
                self.assertEqual(result["status"], "ok")
        x = assessment(db, MINT, AT + 720)
        self.assertTrue(x["assessment"]["radars"]["acceleration"]["detected"])
        self.assertEqual(len(history(db, MINT)), 3)
        self.assertNotEqual(x["assessment"]["state"], "validated")
        self.assertIsNone(x["social"]["score"])
        db.close()

    def test_history_retains_baseline_beyond_old_360_sample_limit(self):
        db = connect(":memory:")
        rows = [sample(AT - 48 * 3600 + i * 180) for i in range(961)]
        for row in rows:
            ingest(db, [row], AT)
        h = history(db, MINT)
        self.assertEqual(len(h), 961)
        self.assertEqual(h[0]["observed_at"], AT - 48 * 3600)
        db.close()

    def test_cache_preserves_original_observation_time(self):
        db = connect(":memory:")
        http = HTTP(db)
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b"[]"
        with (
            patch("server.sources.now", return_value=AT),
            patch("urllib.request.urlopen", return_value=response),
        ):
            http.request("test", "https://test.invalid", ttl=180)
        with (
            patch("server.sources.now", return_value=AT + 100),
            patch("urllib.request.urlopen") as call,
        ):
            http.request("test", "https://test.invalid", ttl=180)
            self.assertEqual(http.last_observed_at, AT)
            call.assert_not_called()
        ingest(db, [sample(AT)], AT)
        ingest(db, [sample(AT)], AT + 100)
        self.assertEqual(len(history(db, MINT)), 1)
        self.assertEqual(db.execute("SELECT last_seen FROM tokens").fetchone()[0], AT)
        db.close()

    def test_one_social_post_can_reference_two_contracts(self):
        db = connect(":memory:")
        for mint in [MINT, "11111111111111111111111111111111"]:
            db.execute(
                "INSERT INTO social VALUES(?,?,?,?,?,?,?)",
                ("same-uri", mint, AT, AT, "author", "TEST FIXTURE", "test"),
            )
        self.assertEqual(db.execute("SELECT count(*) FROM social").fetchone()[0], 2)
        db.close()

    def test_future_snapshot_rejected(self):
        db = connect(":memory:")
        with self.assertRaises(ValueError):
            ingest(db, [sample(AT + 1)], AT)
        self.assertEqual(db.execute("SELECT count(*) FROM tokens").fetchone()[0], 0)
        db.close()


class APITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="edge-api-")
        self.env = patch.dict(
            "os.environ",
            {
                "EDGE_DB": str(Path(self.temp.name) / "test.db"),
                "JUPITER_API_KEY": "NOT_A_REAL_KEY_TEST_FIXTURE",
            },
        )
        self.env.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.env.stop()
        self.temp.cleanup()

    def request(self, path, method="GET", body=None, headers=None):
        request = urllib.request.Request(
            self.url + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, json.load(response)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def test_no_credential_value_in_api(self):
        status, body = self.request("/api/overview")
        self.assertEqual(status, 200)
        self.assertNotIn("NOT_A_REAL_KEY_TEST_FIXTURE", json.dumps(body))

    def test_archive_search_preserves_inactive_contracts(self):
        db = connect()
        ingest(db, [sample(now())], now())
        db.execute("UPDATE tokens SET active=0,inactive_reason='expired'")
        db.close()
        status, body = self.request("/api/archive?q=" + MINT)
        self.assertEqual(status, 200)
        self.assertEqual(body["total"], 1)
        self.assertEqual(body["tokens"][0]["assessment"]["state"], "closed")

    def test_cross_origin_write_denied(self):
        status, _ = self.request(
            "/api/collect", "POST", {}, {"Origin": "https://attacker.invalid"}
        )
        self.assertEqual(status, 403)

    def test_unknown_host_denied(self):
        status, _ = self.request("/api/overview", headers={"Host": "attacker.invalid"})
        self.assertEqual(status, 403)

    def test_non_object_json_rejected(self):
        status, _ = self.request("/api/settings", "PUT", [])
        self.assertEqual(status, 400)

    def test_config_roundtrip_and_conflict(self):
        _, data = self.request("/api/overview")
        c = copy.deepcopy(data["config"])
        c["min_liquidity"] = 30000
        status, _ = self.request(
            "/api/settings", "PUT", {"config": c, "revision": data["config_revision"]}
        )
        self.assertEqual(status, 200)
        _, next_data = self.request("/api/overview")
        self.assertEqual(next_data["config"]["min_liquidity"], 30000)
        status, _ = self.request(
            "/api/settings", "PUT", {"config": c, "revision": data["config_revision"]}
        )
        self.assertEqual(status, 400)

    def test_entry_reports_missing_conditions_before_calling_provider(self):
        db = connect()
        ingest(db, [sample(now())], now())
        db.close()
        with patch("server.sources.Quotes.quote") as quote:
            status, body = self.request("/api/paper/open", "POST", {"mint": MINT})
            self.assertEqual(status, 400)
            self.assertIn("Condições pendentes", body["error"])
            quote.assert_not_called()

    def test_traversal_does_not_serve_source(self):
        status, _ = self.request("/../server/config.py")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
