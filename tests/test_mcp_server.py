from __future__ import annotations

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from mcp.server.fastmcp.exceptions import ToolError

from quiz_app.mcp.server import (
    BackendBridge,
    BackendConfig,
    JWTAccessTokenVerifier,
    MCPAuthConfig,
    _decode_response_payload,
    _extract_scopes_from_claims,
    _error_message_from_payload,
    _normalize_auth_config,
    _normalize_base_url,
    create_mcp_server,
)


class MCPServerTests(unittest.TestCase):
    def test_normalize_base_url(self) -> None:
        self.assertEqual(_normalize_base_url("http://localhost:8766/"), "http://localhost:8766")
        with self.assertRaises(ValueError):
            _normalize_base_url("")
        with self.assertRaises(ValueError):
            _normalize_base_url("localhost:8766")

    def test_error_message_from_payload(self) -> None:
        message = _error_message_from_payload(
            422,
            {"error": {"code": "VALIDATION_ERROR", "message": "bad input"}},
        )
        self.assertEqual(message, "Backend 422 VALIDATION_ERROR: bad input")

        detail = _error_message_from_payload(500, {"detail": "oops"})
        self.assertEqual(detail, "Backend 500: oops")

    def test_decode_response_payload(self) -> None:
        json_response = httpx.Response(200, json={"ok": True})
        self.assertEqual(_decode_response_payload(json_response), {"ok": True})

        text_response = httpx.Response(500, text="not-json")
        self.assertEqual(_decode_response_payload(text_response), "not-json")

    def test_extract_scopes_from_claims(self) -> None:
        claims = {
            "scope": "quiz.read quiz.write",
            "scp": ["quiz.read", "quiz.admin"],
            "scopes": ["quiz.ops"],
        }
        scopes = _extract_scopes_from_claims(claims)
        self.assertEqual(scopes, ["quiz.read", "quiz.write", "quiz.admin", "quiz.ops"])

    def test_normalize_auth_config_defaults(self) -> None:
        config = _normalize_auth_config(
            MCPAuthConfig(
                issuer_url="https://issuer.example.com/",
                resource_server_url="https://mcp.example.com/mcp/",
                required_scopes=("quiz.read", "quiz.write"),
            )
        )
        self.assertEqual(config.issuer_url, "https://issuer.example.com")
        self.assertEqual(config.resource_server_url, "https://mcp.example.com/mcp")
        self.assertEqual(config.audience, "https://mcp.example.com/mcp")
        self.assertEqual(config.jwks_url, "https://issuer.example.com/.well-known/jwks.json")

    def test_backend_bridge_requires_token(self) -> None:
        with self.assertRaises(ValueError):
            BackendBridge(BackendConfig(base_url="http://127.0.0.1:8766", bearer_token=""))

    @patch("quiz_app.mcp.server.httpx.AsyncClient")
    def test_backend_bridge_surfaces_api_errors(self, mock_async_client) -> None:
        response = httpx.Response(
            422,
            json={"error": {"code": "VALIDATION_ERROR", "message": "OpenAI OAuth client ID is required."}},
        )
        client = AsyncMock()
        client.request = AsyncMock(return_value=response)

        manager = AsyncMock()
        manager.__aenter__.return_value = client
        manager.__aexit__.return_value = None
        mock_async_client.return_value = manager

        bridge = BackendBridge(BackendConfig(base_url="http://127.0.0.1:8766", bearer_token="dev-token"))

        async def _run() -> None:
            await bridge.request("POST", "/v1/oauth/openai/connect", payload={})

        with self.assertRaises(ToolError) as ctx:
            asyncio.run(_run())

        self.assertIn("VALIDATION_ERROR", str(ctx.exception))

    def test_create_mcp_server(self) -> None:
        server = create_mcp_server(
            api_base_url="http://127.0.0.1:8766",
            api_token="dev-token",
            host="127.0.0.1",
            port=8768,
        )
        self.assertEqual(server.name, "modular-quiz")

    @patch("quiz_app.mcp.server.PyJWKClient")
    @patch("quiz_app.mcp.server.jwt")
    def test_jwt_access_token_verifier(self, mock_jwt, mock_jwk_client_cls) -> None:
        mock_jwk_client = mock_jwk_client_cls.return_value
        mock_jwk_client.get_signing_key_from_jwt.return_value = SimpleNamespace(key="stub-key")
        mock_jwt.decode.return_value = {
            "sub": "user-123",
            "scope": "quiz.read quiz.write",
            "exp": 2000000000,
            "aud": "https://mcp.example.com/mcp",
        }

        verifier = JWTAccessTokenVerifier(
            MCPAuthConfig(
                issuer_url="https://issuer.example.com",
                resource_server_url="https://mcp.example.com/mcp",
            )
        )

        async def _run():
            return await verifier.verify_token("token-123")

        token = asyncio.run(_run())
        self.assertIsNotNone(token)
        self.assertEqual(token.client_id, "user-123")
        self.assertEqual(token.scopes, ["quiz.read", "quiz.write"])
        self.assertEqual(token.resource, "https://mcp.example.com/mcp")

    @patch("quiz_app.mcp.server.PyJWKClient")
    @patch("quiz_app.mcp.server.jwt")
    def test_jwt_access_token_verifier_invalid_token(self, mock_jwt, mock_jwk_client_cls) -> None:
        mock_jwk_client = mock_jwk_client_cls.return_value
        mock_jwk_client.get_signing_key_from_jwt.side_effect = Exception("invalid")
        mock_jwt.decode.return_value = {}

        verifier = JWTAccessTokenVerifier(
            MCPAuthConfig(
                issuer_url="https://issuer.example.com",
                resource_server_url="https://mcp.example.com/mcp",
            )
        )

        async def _run():
            return await verifier.verify_token("bad-token")

        token = asyncio.run(_run())
        self.assertIsNone(token)


if __name__ == "__main__":
    unittest.main()
