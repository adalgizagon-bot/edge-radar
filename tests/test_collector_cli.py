"""CLI result regressions; these fixtures do not validate market integration."""

import contextlib
import io
import unittest
from unittest.mock import MagicMock, patch
from server.collector import main


class CollectorCLITests(unittest.TestCase):
    def run_once(self, result=None, error=None):
        db = MagicMock()
        with (
            patch("sys.argv", ["collector", "--once"]),
            patch("server.collector.connect", return_value=db),
            patch("server.collector.collect", return_value=result, side_effect=error),
            contextlib.redirect_stdout(io.StringIO()),
            patch("server.collector.log"),
        ):
            code = main()
        db.close.assert_called_once()
        return code

    def test_blocked_empty_round_is_not_success(self):
        self.assertEqual(self.run_once({"status": "partial", "observations": 0}), 2)

    def test_internal_error_not_swallowed_as_success(self):
        self.assertEqual(self.run_once(error=RuntimeError("unit-test failure")), 1)

    def test_partial_with_observations_is_useful_degraded_round(self):
        self.assertEqual(self.run_once({"status": "partial", "observations": 1}), 0)

    def test_successful_empty_response_is_distinct_from_blockage(self):
        self.assertEqual(self.run_once({"status": "ok", "observations": 0}), 0)

    def test_not_due_is_normal_noop(self):
        self.assertEqual(self.run_once({"status": "not_due"}), 0)

    def test_busy_is_normal_noop(self):
        self.assertEqual(self.run_once({"status": "busy"}), 0)


if __name__ == "__main__":
    unittest.main()
