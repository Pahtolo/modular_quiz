from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from quiz_app.openai_auth import (
    OAuthConfig,
    OAuthError,
    OAuthTokenSet,
    OpenAIPKCEAuthenticator,
    refresh_access_token,
)


class OpenAIOAuthTests(unittest.TestCase):
    def _config(self) -> OAuthConfig:
        return OAuthConfig(
            authorize_url="https://auth.openai.com/oauth/authorize",
            token_url="https://auth.openai.com/oauth/token",
            client_id="client-id-123",
            scopes=("model.read", "response.write"),
            redirect_port=8765,
        )

    def test_authorize_in_browser_reports_missing_config_fields(self) -> None:
        auth = OpenAIPKCEAuthenticator(
            OAuthConfig(
                authorize_url="",
                token_url="",
                client_id="",
                scopes=(),
                redirect_port=8765,
            )
        )
        with self.assertRaises(OAuthError) as ctx:
            auth.authorize_in_browser(opener=lambda _url: True)
        self.assertIn("Missing: authorize_url, token_url, client_id", str(ctx.exception))

    @patch("quiz_app.openai_auth.subprocess.run")
    @patch("quiz_app.openai_auth.secrets.token_urlsafe")
    def test_authorize_in_browser_uses_os_fallback_when_webbrowser_fails(
        self,
        mock_token_urlsafe,
        mock_subprocess_run,
    ) -> None:
        mock_token_urlsafe.side_effect = ["verifier-token", "oauth-state-token"]
        mock_subprocess_run.return_value = SimpleNamespace(returncode=0)

        auth = OpenAIPKCEAuthenticator(self._config())
        with patch.object(auth, "_listen_for_callback", return_value={"state": ["oauth-state-token"], "code": ["abc"]}):
            with patch.object(
                auth,
                "_exchange_code",
                return_value=OAuthTokenSet(access_token="access-token"),
            ):
                token = auth.authorize_in_browser(opener=lambda _url: False)

        self.assertEqual(token.access_token, "access-token")
        self.assertTrue(mock_subprocess_run.called)

    @patch("quiz_app.openai_auth.subprocess.run")
    @patch("quiz_app.openai_auth.secrets.token_urlsafe")
    def test_authorize_in_browser_shows_manual_url_if_open_fails(
        self,
        mock_token_urlsafe,
        mock_subprocess_run,
    ) -> None:
        mock_token_urlsafe.side_effect = ["verifier-token", "oauth-state-token"]
        mock_subprocess_run.return_value = SimpleNamespace(returncode=1)

        auth = OpenAIPKCEAuthenticator(self._config())
        with self.assertRaises(OAuthError) as ctx:
            auth.authorize_in_browser(opener=lambda _url: False)

        self.assertIn("Open this URL manually:", str(ctx.exception))
        self.assertIn("https://auth.openai.com/oauth/authorize?", str(ctx.exception))

    @patch("quiz_app.openai_auth.HTTPServer", side_effect=OSError("Address already in use"))
    def test_listen_for_callback_port_conflict_message(self, _mock_server) -> None:
        auth = OpenAIPKCEAuthenticator(self._config())
        with self.assertRaises(OAuthError) as ctx:
            auth._listen_for_callback(timeout_s=1)
        self.assertIn("Failed to listen for OAuth callback", str(ctx.exception))
        self.assertIn("8765", str(ctx.exception))

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
