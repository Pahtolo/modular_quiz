from __future__ import annotations

import unittest
from unittest.mock import patch

from quiz_app import http_tls


class HttpTlsTests(unittest.TestCase):
    def tearDown(self) -> None:
        http_tls.default_ssl_context.cache_clear()

    def test_urlopen_uses_certifi_backed_context(self) -> None:
        sentinel_context = object()

        with (
            patch("quiz_app.http_tls.certifi") as mocked_certifi,
            patch("quiz_app.http_tls.ssl.create_default_context", return_value=sentinel_context) as mocked_context,
            patch("quiz_app.http_tls.urllib.request.urlopen", return_value="response") as mocked_open,
        ):
            mocked_certifi.where.return_value = "/tmp/certifi.pem"

            response = http_tls.urlopen_with_trust_store("https://example.com", timeout=5)

        self.assertEqual(response, "response")
        mocked_context.assert_called_once_with(cafile="/tmp/certifi.pem")
        mocked_open.assert_called_once_with("https://example.com", timeout=5, context=sentinel_context)


if __name__ == "__main__":
    unittest.main()
