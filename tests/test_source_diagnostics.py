"""Transport regression tests, not live-provider validation."""

import json
import unittest
import urllib.error
from unittest.mock import MagicMock, patch
from scripts.check_sources import probe
from server.db import connect
from server.sources import HTTP, SourceError

TARGET = ("test", "https://example.invalid/public", None)


class ProbeTests(unittest.TestCase):
    def test_connect_denial_is_not_api_403(self):
        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError(
                "Tunnel connection failed: 403 Forbidden"
            ),
        ):
            result = probe(TARGET)
        self.assertEqual(result["stage"], "proxy_connect_denied")
        self.assertEqual(result["proxy_http_status"], 403)
        self.assertIsNone(result["api_http_status"])

    def test_upstream_forbidden_not_confused_with_connect(self):
        error = urllib.error.HTTPError(TARGET[1], 403, "Forbidden", {}, None)
        with patch("urllib.request.urlopen", side_effect=error):
            result = probe(TARGET)
        self.assertEqual(result["stage"], "upstream_http_error")
        self.assertEqual(result["api_http_status"], 403)
        self.assertIsNone(result["proxy_http_status"])

    def test_authentication_failure_separate_from_network(self):
        error = urllib.error.HTTPError(TARGET[1], 401, "Unauthorized", {}, None)
        with patch("urllib.request.urlopen", side_effect=error):
            result = probe(TARGET)
        self.assertEqual(result["api_http_status"], 401)
        self.assertEqual(result["stage"], "upstream_http_error")

    def test_success_json_rpc_error_not_successful_integration(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"error": {"code": -32005}}
        ).encode()
        response.__enter__.return_value.status = 200
        response.__enter__.return_value.url = TARGET[1]
        with patch("urllib.request.urlopen", return_value=response):
            result = probe(TARGET)
        self.assertTrue(result["api_error"])
        self.assertEqual(result["api_http_status"], 200)

    def test_arbitrary_transport_errors_do_not_leak_details(self):
        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError("private-token-do-not-record"),
        ):
            result = probe(TARGET)
        self.assertEqual(result["stage"], "transport_error")
        self.assertNotIn("private-token", json.dumps(result))

    def test_runtime_error_preserves_transport_diagnosis(self):
        db = connect(":memory:")
        with patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.URLError(
                "Tunnel connection failed: 403 Forbidden"
            ),
        ):
            with self.assertRaisesRegex(SourceError, "Proxy CONNECT negado"):
                HTTP(db).request("test", TARGET[1])
        saved = db.execute("SELECT error FROM source_state").fetchone()["error"]
        self.assertIn("API não alcançada", saved)
        db.close()


if __name__ == "__main__":
    unittest.main()
