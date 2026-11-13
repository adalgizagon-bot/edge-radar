"""Synthetic fixtures here are unit-test inputs only, never served by the application."""

import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
from server.config import DEFAULTS, validate
from server.db import (
    connect,
    ingest,
    history,
    acquire,
    settings,
    save_settings,
    dump,
    now,
)
from server.analysis import evaluate, CLASSIC_SPL, social_summary
from server.sources import HTTP, Market, Security, Social, Quotes, SourceError, USDC
from server.paper import metrics, monitor, open_position, roundtrip
from server.collector import collect

AT = 1_800_000_000
MINT = "So11111111111111111111111111111111111111112"
TOKEN = {"mint": MINT, "pool_created": AT - 3600, "active": 1}
SEC = {
    "mint_authority": None,
    "freeze_authority": None,
    "largest_account_pct": 5,
    "token_program": CLASSIC_SPL,
    "observed_at": AT,
}
SOC = {"score": 60, "growth_pct": 50}


def sample(at=AT, **kwargs):
    return {
        "mint": MINT,
        "name": "UNIT TEST ONLY",
        "symbol": "TEST",
        "source": "test-fixture",
        "pool": "test-pool",
        "pool_created": AT - 3600,
        "price": 1,
        "liquidity": 50000,
        "volume5m": 6000,
        "buys": 50,
        "sells": 15,
        "change5m": 4,
        "observed_at": at,
        **kwargs,
    }


def samples():
    return [
        sample(AT - 600, volume5m=2000, buys=25, price=0.95),
        sample(AT - 300, volume5m=4000, buys=40, price=0.97),
        sample(),
    ]


def evaluate_fixture(
    h=None, security=SEC, social=SOC, config=None, token=None, quote=None
):
    return evaluate(
        token or TOKEN,
        h if h is not None else samples(),
        security,
        social,
        config or copy.deepcopy(DEFAULTS),
        AT,
        quote,
    )


class AnalysisTests(unittest.TestCase):
    def test_empty_stays_incomplete(self):
        x = evaluate_fixture([], None, {})
        self.assertTrue(all(v is None for v in x["scores"].values()))
        self.assertNotEqual(x["state"], "validated")

    def test_three_radars_are_independent(self):
        x = evaluate_fixture()
        self.assertTrue(x["radars"]["new"]["detected"])
        self.assertTrue(x["radars"]["acceleration"]["detected"])
        self.assertFalse(x["radars"]["revival"]["detected"])

    def test_revived_old_pool_needs_historical_baseline(self):
        token = dict(TOKEN, pool_created=AT - 86400 * 7)
        self.assertFalse(evaluate_fixture(token=token)["radars"]["revival"]["detected"])
        old = [sample(AT - 36 * 3600 + i * 3600, volume5m=500) for i in range(6)]
        self.assertTrue(
            evaluate_fixture(old + samples(), token=token)["radars"]["revival"][
                "detected"
            ]
        )

    def test_missing_liquidity_not_acceleration(self):
        h = [dict(x, liquidity=None) for x in samples()]
        self.assertFalse(evaluate_fixture(h)["radars"]["acceleration"]["detected"])

    def test_pool_switch_not_compared(self):
        h = samples()
        h[-1]["pool"] = "another"
        self.assertIsNone(evaluate_fixture(h)["scores"]["momentum"])

    def test_provider_switch_not_compared(self):
        h = samples()
        h[-1]["source"] = "another"
        self.assertFalse(evaluate_fixture(h)["radars"]["acceleration"]["detected"])

    def test_overlapping_windows_insufficient(self):
        h = [sample(AT - 120, volume5m=1000), sample(AT - 60, volume5m=2000), sample()]
        self.assertIsNone(evaluate_fixture(h)["scores"]["momentum"])

    def test_future_observations_ignored(self):
        a = evaluate_fixture()
        b = evaluate_fixture(
            samples() + [sample(AT + 60, price=500, volume5m=10000000)]
        )
        self.assertEqual(a, b)

    def test_missing_social_not_neutral_or_zero(self):
        x = evaluate_fixture(social={})
        self.assertIsNone(x["scores"]["social"])
        self.assertIsNone(x["scores"]["opportunity"])

    def test_zero_weight_allows_missing_social(self):
        c = copy.deepcopy(DEFAULTS)
        c["weights"] = {"momentum": 0.6, "flow": 0.4, "social": 0}
        self.assertIsNotNone(
            evaluate_fixture(social={}, config=c)["scores"]["opportunity"]
        )

    def test_no_opportunity_score_without_risk(self):
        self.assertIsNone(evaluate_fixture(security=None)["scores"]["opportunity"])

    def test_high_score_not_entry(self):
        self.assertNotEqual(evaluate_fixture()["state"], "validated")

    def test_entry_validated_for_simulation_with_all_checks(self):
        x = evaluate_fixture(quote={"ok": True, "observed_at": AT})
        self.assertEqual(x["state"], "validated")
        self.assertTrue(all(c["passed"] for c in x["checks"]))

    def test_authority_overrides_quote(self):
        sec = dict(SEC, mint_authority="active")
        self.assertEqual(
            evaluate_fixture(security=sec, quote={"ok": True, "observed_at": AT})[
                "state"
            ],
            "high_risk",
        )

    def test_expired_security(self):
        x = evaluate_fixture(security=dict(SEC, observed_at=AT - 1900))
        self.assertIsNone(x["scores"]["risk"])

    def test_expired_price_blocks_entry(self):
        h = [dict(x, observed_at=x["observed_at"] - 1000) for x in samples()]
        self.assertNotEqual(
            evaluate_fixture(h, quote={"ok": True, "observed_at": AT})["state"],
            "validated",
        )

    def test_extended_price_waits(self):
        h = samples()
        h[-1]["change5m"] = 30
        self.assertEqual(evaluate_fixture(h)["state"], "wait")

    def test_inactive_closed(self):
        self.assertEqual(
            evaluate_fixture(token=dict(TOKEN, active=0))["state"], "closed"
        )

    def test_missing_age_not_new(self):
        self.assertFalse(
            evaluate_fixture(token=dict(TOKEN, pool_created=None))["radars"]["new"][
                "detected"
            ]
        )

    def test_bad_risk_not_safe(self):
        self.assertIsNone(evaluate_fixture(security=None)["scores"]["risk"])


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.db = connect(":memory:")

    def tearDown(self):
        self.db.close()

    def test_ingestion_deduplicates_and_retains(self):
        ingest(self.db, [sample()], AT)
        ingest(self.db, [sample()], AT)
        self.assertEqual(len(history(self.db, MINT)), 1)
        ingest(self.db, [], AT + 1000)
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM tokens").fetchone()[0], 1
        )

    def test_persistence_survives_reopen(self):
        with tempfile.TemporaryDirectory() as d:
            path = str(Path(d) / "db")
            db = connect(path)
            ingest(db, [sample()], AT)
            db.close()
            db = connect(path)
            self.assertEqual(len(history(db, MINT)), 1)
            db.close()

    def test_lease_owner_and_expiry(self):
        self.assertTrue(acquire(self.db, "a", AT, 60))
        self.assertFalse(acquire(self.db, "b", AT + 1, 60))
        self.assertTrue(acquire(self.db, "b", AT + 61, 60))

    def test_config_conflict(self):
        c, v = settings(self.db)
        save_settings(self.db, c, v)
        with self.assertRaises(ValueError):
            save_settings(self.db, c, v)

    def test_setting_validation(self):
        for key, value in [
            ("collect_seconds", 10),
            ("refresh_seconds", float("nan")),
            ("min_liquidity", True),
            ("paper_max_open", 1.5),
        ]:
            c = copy.deepcopy(DEFAULTS)
            c[key] = value
            with self.assertRaises(ValueError):
                validate(c)

    def test_weights_must_sum_one(self):
        c = copy.deepcopy(DEFAULTS)
        c["weights"]["flow"] = 0.9
        with self.assertRaises(ValueError):
            validate(c)

    def test_social_first_scan_not_growth(self):
        self.db.execute(
            "INSERT INTO social_checks VALUES(?,?,?)",
            (MINT, AT, dump({"ok": True, "coverage_since": AT})),
        )
        x = social_summary(self.db, MINT, AT)
        self.assertIsNone(x["growth_pct"])
        self.assertIsNone(x["score"])

    def test_failed_sources_preserve_tokens(self):
        ingest(self.db, [sample(now())], now())

        class Broken:
            remaining = 24

            def request(self, *args, **kwargs):
                raise SourceError("intentional unit-test failure")

        result = collect(self.db, Broken())
        self.assertEqual(result["status"], "partial")
        self.assertEqual(
            self.db.execute("SELECT count(*) FROM tokens").fetchone()[0], 1
        )
        self.assertEqual(collect(self.db, Broken())["status"], "not_due")

    def test_failures_do_not_keep_lease(self):
        class Broken:
            remaining = 24

            def request(self, *args, **kwargs):
                raise RuntimeError("unexpected")

        with self.assertRaises(RuntimeError):
            collect(self.db, Broken())
        self.assertEqual(self.db.execute("SELECT count(*) FROM jobs").fetchone()[0], 0)


class FakeQuotes:
    def __init__(self, out=19_900_000, at=AT, fail=False):
        self.out = out
        self.at = at
        self.fail = fail

    def quote(self, input_mint, output_mint, amount, slippage):
        if self.fail:
            raise SourceError("route unavailable")
        return {
            "inputMint": input_mint,
            "outputMint": output_mint,
            "inAmount": str(amount),
            "otherAmountThreshold": str(self.out if output_mint == USDC else 1000),
            "observed_at": self.at,
            "source": "unit-test-only",
        }


class PaperTests(unittest.TestCase):
    def setUp(self):
        self.db = connect(":memory:")
        self.c = copy.deepcopy(DEFAULTS)
        self.q = roundtrip(FakeQuotes(), MINT, self.c, AT)
        self.a = evaluate_fixture(quote=self.q)

    def tearDown(self):
        self.db.close()

    def open(self):
        return open_position(self.db, MINT, self.a, self.c, self.q, AT)

    def test_no_fill_without_validation(self):
        self.a["state"] = "monitoring"
        with self.assertRaises(ValueError):
            self.open()

    def test_stale_quote_not_fill(self):
        self.q["observed_at"] = AT - 31
        with self.assertRaises(ValueError):
            self.open()

    def test_future_assessment_not_fill(self):
        self.a["observed_at"] = AT + 1
        with self.assertRaises(ValueError):
            self.open()

    def test_duplicate_open_prevented(self):
        self.open()
        with self.assertRaises(ValueError):
            self.open()

    def test_policy_frozen(self):
        self.open()
        self.c["strategies"]["early"]["stop_loss"] = -20
        row = self.db.execute("SELECT policy FROM trades").fetchone()
        self.assertEqual(json.loads(row[0])["strategy"]["stop_loss"], -6)

    def test_gap_loss_not_stop_fill(self):
        self.open()
        monitor(self.db, FakeQuotes(out=10_000_000, at=AT + 180), AT + 180)
        t = dict(self.db.execute("SELECT * FROM trades").fetchone())
        self.assertEqual(t["status"], "closed")
        self.assertEqual(t["reason"], "stop")
        self.assertAlmostEqual(t["pnl"], -10.1)

    def test_route_failure_does_not_close_or_invent_price(self):
        self.open()
        monitor(self.db, FakeQuotes(fail=True), AT + 2000)
        t = dict(self.db.execute("SELECT * FROM trades").fetchone())
        self.assertEqual(t["status"], "exit_unavailable")
        self.assertIsNone(t["pnl"])

    def test_timeout_requires_current_quote(self):
        self.open()
        monitor(self.db, FakeQuotes(out=20_000_000, at=AT + 1800), AT + 1800)
        self.assertEqual(
            self.db.execute("SELECT reason FROM trades").fetchone()[0], "time"
        )

    def test_future_quote_not_used(self):
        self.open()
        monitor(self.db, FakeQuotes(out=99_000_000, at=AT + 5000), AT + 30)
        self.assertEqual(
            self.db.execute("SELECT status FROM trades").fetchone()[0],
            "exit_unavailable",
        )

    def test_roundtrip_poor_recovery_rejected(self):
        self.assertFalse(roundtrip(FakeQuotes(out=10_000_000), MINT, self.c, AT)["ok"])

    def test_metrics_include_losses_and_sequence(self):
        rows = [
            {"id": i, "status": "closed", "closed_at": i, "pnl": v}
            for i, v in enumerate([10, -20, 5])
        ]
        x = metrics(rows, 100)
        self.assertEqual(x["net_pnl"], -5)
        self.assertEqual(x["max_drawdown_usd"], 20)
        self.assertEqual(x["profit_factor"], 0.75)
        self.assertAlmostEqual(x["win_rate"], 200 / 3)

    def test_no_trades_no_rate_or_profit_factor(self):
        x = metrics([])
        self.assertIsNone(x["win_rate"])
        self.assertIsNone(x["profit_factor"])


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.db = connect(":memory:")

    def tearDown(self):
        self.db.close()

    def test_backoff_prevents_repeat_network(self):
        http = HTTP(self.db)
        import urllib.error

        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.HTTPError(
                "https://test.invalid", 429, "limited", {}, None
            ),
        ) as call:
            with self.assertRaises(SourceError):
                http.request("test", "https://test.invalid")
            with self.assertRaises(SourceError):
                http.request("test", "https://test.invalid")
            self.assertEqual(call.call_count, 1)
        self.assertEqual(
            self.db.execute("SELECT failures FROM source_state").fetchone()[0], 1
        )

    def test_http_cache(self):
        from unittest.mock import MagicMock

        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"real_format":true}'
        with patch("urllib.request.urlopen", return_value=response) as call:
            http = HTTP(self.db)
            http.request("test", "https://test.invalid")
            http.request("test", "https://test.invalid")
            self.assertEqual(call.call_count, 1)

    def test_no_jupiter_key_no_quote(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(SourceError):
                Quotes(HTTP(self.db)).quote(USDC, MINT, 100, 100)

    def test_dex_adapter_best_pool_no_fake_fields(self):
        class Fake:
            def request(self, *args, **kwargs):
                return [
                    {
                        "chainId": "solana",
                        "baseToken": {
                            "address": MINT,
                            "name": "fixture",
                            "symbol": "TEST",
                        },
                        "priceUsd": "1.25",
                        "liquidity": {"usd": 5000},
                        "txns": {"m5": {"buys": 3, "sells": 2}},
                    },
                    {
                        "chainId": "solana",
                        "baseToken": {"address": MINT},
                        "priceUsd": "1.3",
                        "liquidity": {"usd": 10000},
                    },
                ]

        x = Market(Fake()).prices([MINT])
        self.assertEqual(len(x), 1)
        self.assertEqual(x[0]["price"], 1.3)
        self.assertIsNone(x[0]["unique_buyers"])

    def test_gecko_missing_marketcap_not_fdv_substitution(self):
        class Fake:
            def request(self, *args, **kwargs):
                return {
                    "data": [
                        {
                            "attributes": {"fdv_usd": "5000"},
                            "relationships": {
                                "base_token": {"data": {"id": "solana_" + MINT}}
                            },
                        }
                    ]
                }

        x = Market(Fake()).gecko("new")[0]
        self.assertIsNone(x["market_cap"])
        self.assertEqual(x["fdv"], 5000)

    def test_social_symbols_not_contracts(self):
        class Fake:
            def request(self, *args, **kwargs):
                return {
                    "posts": [
                        {
                            "uri": "1",
                            "record": {
                                "text": "SOL is great",
                                "createdAt": "2026-01-01T00:00:00Z",
                            },
                        }
                    ]
                }

        self.assertEqual(Social(Fake()).search(MINT), [])

    def test_rpc_missing_authority_keys_not_revoked(self):
        class Fake:
            def request(self, *args, **kwargs):
                return {
                    "result": {
                        "value": {
                            "data": {
                                "parsed": {"type": "mint", "info": {"supply": "100"}}
                            }
                        }
                    }
                }

        with self.assertRaises(SourceError):
            Security(Fake()).inspect(MINT)


if __name__ == "__main__":
    unittest.main()
