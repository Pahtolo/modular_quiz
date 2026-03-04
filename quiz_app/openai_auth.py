import base64
import hashlib
import json
import secrets
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable


@dataclass(frozen=True)
class OAuthConfig:
    authorize_url: str
    token_url: str
    client_id: str
    scopes: tuple[str, ...]
    redirect_port: int = 8765


@dataclass
class OAuthTokenSet:
    access_token: str
    refresh_token: str = ""
    expires_at: float = 0.0
    token_type: str = "Bearer"

    @property
    def is_expired(self) -> bool:
        if self.expires_at <= 0:
            return False
        return time.time() >= (self.expires_at - 30)


class OAuthError(RuntimeError):
    pass


class _OAuthCallbackHandler(BaseHTTPRequestHandler):
    query: dict[str, list[str]] = {}
    event: threading.Event

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        _OAuthCallbackHandler.query = params
        _OAuthCallbackHandler.event.set()

        if "error" in params:
            body = "OAuth authorization failed. You can close this tab."
        else:
            body = "Authorization complete. You can close this tab and return to the app."

        payload = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class OpenAIPKCEAuthenticator:
    def __init__(self, config: OAuthConfig):
        self.config = config

    @staticmethod
    def _code_verifier() -> str:
        return secrets.token_urlsafe(64)

    @staticmethod
    def _code_challenge(verifier: str) -> str:
        digest = hashlib.sha256(verifier.encode("utf-8")).digest()
        return base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")

    def _build_auth_url(self, state: str, code_challenge: str) -> str:
        redirect_uri = f"http://127.0.0.1:{self.config.redirect_port}/oauth/callback"
        query = {
            "response_type": "code",
            "client_id": self.config.client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(self.config.scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        return f"{self.config.authorize_url}?{urllib.parse.urlencode(query)}"

    def _listen_for_callback(self, timeout_s: int = 180) -> dict[str, list[str]]:
        _OAuthCallbackHandler.event = threading.Event()
        _OAuthCallbackHandler.query = {}
        server = HTTPServer(("127.0.0.1", self.config.redirect_port), _OAuthCallbackHandler)
        server.timeout = timeout_s

        def _serve() -> None:
            try:
                while not _OAuthCallbackHandler.event.is_set():
                    server.handle_request()
            finally:
                server.server_close()

        thread = threading.Thread(target=_serve, daemon=True)
        thread.start()

        if not _OAuthCallbackHandler.event.wait(timeout=timeout_s):
            raise OAuthError("Timed out waiting for OAuth callback.")
        return _OAuthCallbackHandler.query

    def _exchange_code(self, code: str, code_verifier: str) -> OAuthTokenSet:
        redirect_uri = f"http://127.0.0.1:{self.config.redirect_port}/oauth/callback"
        payload = {
            "grant_type": "authorization_code",
            "client_id": self.config.client_id,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }
        req = urllib.request.Request(
            self.config.token_url,
            data=urllib.parse.urlencode(payload).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # broad to preserve response details for UI
            raise OAuthError(f"Token exchange failed: {exc}") from exc

        if "error" in body:
            raise OAuthError(f"Token exchange error: {body.get('error_description') or body['error']}")

        expires_in = body.get("expires_in")
        expires_at = time.time() + float(expires_in) if expires_in else 0.0
        return OAuthTokenSet(
            access_token=body.get("access_token", ""),
            refresh_token=body.get("refresh_token", ""),
            expires_at=expires_at,
            token_type=body.get("token_type", "Bearer"),
        )

    def authorize_in_browser(self, opener: Callable[[str], bool] | None = None) -> OAuthTokenSet:
        if not self.config.authorize_url or not self.config.token_url or not self.config.client_id:
            raise OAuthError("OAuth config is incomplete.")

        opener = opener or webbrowser.open
        verifier = self._code_verifier()
        challenge = self._code_challenge(verifier)
        state = secrets.token_urlsafe(24)
        auth_url = self._build_auth_url(state, challenge)

        opened = opener(auth_url)
        if not opened:
            raise OAuthError("Could not open browser for OAuth authorization.")

        params = self._listen_for_callback()
        if "error" in params:
            err = params.get("error", ["unknown_error"])[0]
            desc = params.get("error_description", [""])[0]
            raise OAuthError(f"OAuth authorization error: {err} {desc}".strip())

        callback_state = params.get("state", [""])[0]
        if callback_state != state:
            raise OAuthError("OAuth state mismatch.")

        code = params.get("code", [""])[0]
        if not code:
            raise OAuthError("OAuth callback missing authorization code.")

        token = self._exchange_code(code=code, code_verifier=verifier)
        if not token.access_token:
            raise OAuthError("OAuth token exchange returned no access token.")
        return token


def refresh_access_token(config: OAuthConfig, refresh_token: str) -> OAuthTokenSet:
    if not refresh_token:
        raise OAuthError("No refresh token available.")

    payload = {
        "grant_type": "refresh_token",
        "client_id": config.client_id,
        "refresh_token": refresh_token,
    }
    req = urllib.request.Request(
        config.token_url,
        data=urllib.parse.urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise OAuthError(f"Token refresh failed: {exc}") from exc

    if "error" in body:
        raise OAuthError(f"Token refresh error: {body.get('error_description') or body['error']}")

    expires_in = body.get("expires_in")
    expires_at = time.time() + float(expires_in) if expires_in else 0.0
    return OAuthTokenSet(
        access_token=body.get("access_token", ""),
        refresh_token=body.get("refresh_token", refresh_token),
        expires_at=expires_at,
        token_type=body.get("token_type", "Bearer"),
    )
