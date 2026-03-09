from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from quiz_app.openai_auth import OAuthConfig, OpenAIPKCEAuthenticator, refresh_access_token


class OpenAIAuthTests(unittest.TestCase):
    def test_exchange_code_uses_trust_store_urlopen(self) -> None:
        auth = OpenAIPKCEAuthenticator(
            OAuthConfig(
                authorize_url="https://example.com/auth",
                token_url="https://example.com/token",
                client_id="client-id",
                scopes=("openid",),
            )
        )

        class _Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return json.dumps({"access_token": "token"}).encode("utf-8")

        with patch("quiz_app.openai_auth.urlopen_with_trust_store", return_value=_Response()) as mocked_open:
            token = auth._exchange_code(code="abc", code_verifier="verifier")

        self.assertEqual(token.access_token, "token")
        mocked_open.assert_called_once()

    def test_refresh_access_token_uses_trust_store_urlopen(self) -> None:
        config = OAuthConfig(
            authorize_url="https://example.com/auth",
            token_url="https://example.com/token",
            client_id="client-id",
            scopes=("openid",),
        )

        class _Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read(self) -> bytes:
                return json.dumps({"access_token": "token"}).encode("utf-8")

        with patch("quiz_app.openai_auth.urlopen_with_trust_store", return_value=_Response()) as mocked_open:
            token = refresh_access_token(config, refresh_token="refresh-token")

        self.assertEqual(token.access_token, "token")
        mocked_open.assert_called_once()


if __name__ == "__main__":
    unittest.main()
