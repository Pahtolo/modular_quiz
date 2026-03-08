from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.settings import AuthSettings
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations

try:
    import jwt
    from jwt import PyJWKClient
except Exception:  # pragma: no cover - dependency validated when auth is enabled
    jwt = None
    PyJWKClient = None


DEFAULT_TOOL_TIMEOUT_SECONDS = 60.0
DEFAULT_JWT_ALGORITHMS = ("RS256", "RS384", "RS512", "ES256", "ES384", "ES512")


@dataclass(frozen=True)
class BackendConfig:
    base_url: str
    bearer_token: str
    timeout_seconds: float = DEFAULT_TOOL_TIMEOUT_SECONDS


@dataclass(frozen=True)
class MCPAuthConfig:
    issuer_url: str
    resource_server_url: str
    audience: str = ""
    jwks_url: str = ""
    required_scopes: tuple[str, ...] = ()
    service_documentation_url: str = ""
    algorithms: tuple[str, ...] = DEFAULT_JWT_ALGORITHMS


def _normalize_base_url(value: str) -> str:
    base_url = str(value or "").strip().rstrip("/")
    if not base_url:
        raise ValueError("API base URL is required.")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("API base URL must start with http:// or https://")
    return base_url


def _normalize_http_url(value: str, *, label: str, required: bool = True) -> str:
    normalized = str(value or "").strip().rstrip("/")
    if not normalized:
        if required:
            raise ValueError(f"{label} is required.")
        return ""
    if not normalized.startswith(("http://", "https://")):
        raise ValueError(f"{label} must start with http:// or https://")
    return normalized


def _split_scopes(value: str | list[str] | tuple[str, ...] | None) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        parts = value.replace(",", " ").split()
    elif isinstance(value, (list, tuple)):
        parts = [str(item).strip() for item in value if str(item).strip()]
    else:
        parts = [str(value).strip()]
    return tuple(dict.fromkeys(part for part in parts if part))


def _extract_scopes_from_claims(claims: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("scope", "scp", "scopes"):
        raw = claims.get(key)
        if isinstance(raw, str):
            values.extend([chunk for chunk in raw.split(" ") if chunk])
            continue
        if isinstance(raw, list):
            values.extend([str(chunk).strip() for chunk in raw if str(chunk).strip()])
    return list(dict.fromkeys(values))


def _normalize_auth_config(config: MCPAuthConfig) -> MCPAuthConfig:
    issuer_url = _normalize_http_url(config.issuer_url, label="OAuth issuer URL")
    resource_server_url = _normalize_http_url(
        config.resource_server_url,
        label="OAuth resource server URL",
    )
    jwks_url = _normalize_http_url(
        config.jwks_url,
        label="OAuth JWKS URL",
        required=False,
    ) or f"{issuer_url}/.well-known/jwks.json"
    service_documentation_url = _normalize_http_url(
        config.service_documentation_url,
        label="OAuth service documentation URL",
        required=False,
    )
    audience = str(config.audience or "").strip() or resource_server_url
    required_scopes = _split_scopes(config.required_scopes)
    algorithms = tuple(dict.fromkeys([str(item).strip() for item in config.algorithms if str(item).strip()]))
    if not algorithms:
        raise ValueError("At least one JWT signing algorithm is required.")

    return MCPAuthConfig(
        issuer_url=issuer_url,
        resource_server_url=resource_server_url,
        audience=audience,
        jwks_url=jwks_url,
        required_scopes=required_scopes,
        service_documentation_url=service_documentation_url,
        algorithms=algorithms,
    )


def _error_message_from_payload(status_code: int, payload: Any) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            code = str(error.get("code", "HTTP_ERROR")).strip() or "HTTP_ERROR"
            message = str(error.get("message", "")).strip() or f"Backend returned HTTP {status_code}."
            return f"Backend {status_code} {code}: {message}"
        detail = payload.get("detail")
        if detail is not None:
            return f"Backend {status_code}: {detail}"
    if isinstance(payload, str) and payload.strip():
        return f"Backend {status_code}: {payload.strip()}"
    return f"Backend request failed with HTTP {status_code}."


def _decode_response_payload(response: httpx.Response) -> Any:
    if not response.content:
        return {}
    try:
        return response.json()
    except Exception:
        body = response.text.strip()
        if not body:
            return {}
        try:
            return json.loads(body)
        except Exception:
            return body


class BackendBridge:
    def __init__(self, config: BackendConfig):
        token = (config.bearer_token or "").strip()
        if not token:
            raise ValueError("API bearer token is required.")
        self._base_url = _normalize_base_url(config.base_url)
        self._token = token
        self._timeout = float(config.timeout_seconds or DEFAULT_TOOL_TIMEOUT_SECONDS)

    async def request(
        self,
        method: str,
        path: str,
        *,
        payload: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        route = str(path or "").strip()
        if not route.startswith("/"):
            route = f"/{route}"
        url = f"{self._base_url}{route}"
        headers = {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(
                    method.upper(),
                    url,
                    headers=headers,
                    json=payload,
                    params=params,
                )
        except Exception as exc:
            raise ToolError(f"Backend request failed: {exc}") from exc

        decoded = _decode_response_payload(response)
        if response.status_code >= 400:
            raise ToolError(_error_message_from_payload(response.status_code, decoded))
        return decoded


class JWTAccessTokenVerifier(TokenVerifier):
    def __init__(self, config: MCPAuthConfig):
        if jwt is None or PyJWKClient is None:  # pragma: no cover
            raise RuntimeError("PyJWT is required for MCP OAuth verification. Install with: pip install 'PyJWT[crypto]'")

        self._config = _normalize_auth_config(config)
        self._jwk_client = PyJWKClient(self._config.jwks_url)

    async def verify_token(self, token: str) -> AccessToken | None:
        raw_token = str(token or "").strip()
        if not raw_token:
            return None

        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(raw_token)
            claims = jwt.decode(
                raw_token,
                key=signing_key.key,
                algorithms=list(self._config.algorithms),
                audience=self._config.audience,
                issuer=self._config.issuer_url,
                options={"verify_signature": True, "verify_exp": True, "verify_aud": True, "verify_iss": True},
            )
        except Exception:
            return None

        client_id = (
            str(claims.get("azp", "")).strip()
            or str(claims.get("client_id", "")).strip()
            or str(claims.get("sub", "")).strip()
        )
        if not client_id:
            return None

        scopes = _extract_scopes_from_claims(claims)
        exp_value = claims.get("exp")
        expires_at = int(exp_value) if isinstance(exp_value, (int, float)) else None
        aud_claim = claims.get("aud")
        if isinstance(aud_claim, str):
            resource = aud_claim
        elif isinstance(aud_claim, list) and aud_claim:
            resource = str(aud_claim[0]).strip() or None
        else:
            resource = None

        return AccessToken(
            token=raw_token,
            client_id=client_id,
            scopes=scopes,
            expires_at=expires_at,
            resource=resource,
        )


READ_ONLY = ToolAnnotations(readOnlyHint=True, idempotentHint=True)
MUTATING = ToolAnnotations(readOnlyHint=False, idempotentHint=False)


def create_mcp_server(
    *,
    api_base_url: str,
    api_token: str,
    host: str = "127.0.0.1",
    port: int = 8768,
    name: str = "modular-quiz",
    auth_config: MCPAuthConfig | None = None,
) -> FastMCP:
    bridge = BackendBridge(
        BackendConfig(
            base_url=api_base_url,
            bearer_token=api_token,
        )
    )
    normalized_auth = _normalize_auth_config(auth_config) if auth_config else None
    auth_settings = None
    token_verifier = None
    if normalized_auth:
        token_verifier = JWTAccessTokenVerifier(normalized_auth)
        auth_settings = AuthSettings(
            issuer_url=normalized_auth.issuer_url,
            service_documentation_url=normalized_auth.service_documentation_url or None,
            required_scopes=list(normalized_auth.required_scopes) or None,
            resource_server_url=normalized_auth.resource_server_url,
        )

    instructions = (
        "Tools for reading and updating Modular Quiz settings, loading quizzes, "
        "grading answers, running generation, and managing history through the app backend."
    )
    if normalized_auth:
        parsed = urlparse(normalized_auth.resource_server_url)
        resource_path = parsed.path if parsed.path != "/" else ""
        instructions += (
            f" This server uses OAuth bearer tokens issued by {normalized_auth.issuer_url}. "
            f"Protected resource metadata is available at "
            f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{resource_path}."
        )

    mcp = FastMCP(
        name=name,
        instructions=instructions,
        host=host,
        port=port,
        streamable_http_path="/mcp",
        auth=auth_settings,
        token_verifier=token_verifier,
    )

    @mcp.tool(name="quiz_health", description="Check Modular Quiz backend health.", annotations=READ_ONLY)
    async def quiz_health() -> dict[str, Any]:
        return await bridge.request("GET", "/v1/health")

    @mcp.tool(name="quiz_list_models", description="List available models for a provider.", annotations=READ_ONLY)
    async def quiz_list_models(provider: str) -> dict[str, Any]:
        return await bridge.request("GET", "/v1/models", params={"provider": provider})

    @mcp.tool(name="quiz_get_settings", description="Fetch current app settings.", annotations=READ_ONLY)
    async def quiz_get_settings() -> dict[str, Any]:
        return await bridge.request("GET", "/v1/settings")

    @mcp.tool(name="quiz_update_settings", description="Patch app settings.", annotations=MUTATING)
    async def quiz_update_settings(settings_patch: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(settings_patch, dict):
            raise ToolError("settings_patch must be an object.")
        return await bridge.request("PUT", "/v1/settings", payload=settings_patch)

    @mcp.tool(
        name="quiz_sign_in_openai",
        description="Run the OpenAI OAuth connect flow configured in settings.",
        annotations=MUTATING,
    )
    async def quiz_sign_in_openai() -> dict[str, Any]:
        return await bridge.request("POST", "/v1/oauth/openai/connect", payload={})

    @mcp.tool(name="quiz_tree", description="List quiz roots and nested quiz tree.", annotations=READ_ONLY)
    async def quiz_tree(quiz_roots: list[str] | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        if quiz_roots:
            payload["quiz_roots"] = quiz_roots
        return await bridge.request("POST", "/v1/quizzes/tree", payload=payload)

    @mcp.tool(name="quiz_library", description="Get managed Quizzes library tree.", annotations=READ_ONLY)
    async def quiz_library() -> dict[str, Any]:
        return await bridge.request("GET", "/v1/quizzes/library")

    @mcp.tool(name="quiz_library_import", description="Import quiz files/folders into library.", annotations=MUTATING)
    async def quiz_library_import(source_paths: list[str]) -> dict[str, Any]:
        if not source_paths:
            raise ToolError("source_paths must include at least one path.")
        return await bridge.request("POST", "/v1/quizzes/library/import", payload={"source_paths": source_paths})

    @mcp.tool(name="quiz_library_rename", description="Rename quiz title in JSON.", annotations=MUTATING)
    async def quiz_library_rename(path: str, title: str) -> dict[str, Any]:
        if not str(path or "").strip():
            raise ToolError("path is required.")
        if not str(title or "").strip():
            raise ToolError("title is required.")
        return await bridge.request("POST", "/v1/quizzes/library/rename", payload={"path": path, "title": title})

    @mcp.tool(name="quiz_load", description="Load quiz content from a JSON path.", annotations=READ_ONLY)
    async def quiz_load(path: str) -> dict[str, Any]:
        if not str(path or "").strip():
            raise ToolError("path is required.")
        return await bridge.request("POST", "/v1/quizzes/load", payload={"path": path})

    @mcp.tool(name="quiz_grade_mcq", description="Grade a multiple-choice answer.", annotations=READ_ONLY)
    async def quiz_grade_mcq(question: dict[str, Any], user_answer: str) -> dict[str, Any]:
        if not isinstance(question, dict):
            raise ToolError("question must be an object.")
        return await bridge.request(
            "POST",
            "/v1/grade/mcq",
            payload={"question": question, "user_answer": user_answer},
        )

    @mcp.tool(name="quiz_grade_short", description="Grade a short-answer response.", annotations=READ_ONLY)
    async def quiz_grade_short(
        provider: str,
        question: dict[str, Any],
        user_answer: str,
        model: str | None = None,
        self_score: int | None = None,
    ) -> dict[str, Any]:
        if not isinstance(question, dict):
            raise ToolError("question must be an object.")
        payload: dict[str, Any] = {
            "provider": provider,
            "question": question,
            "user_answer": user_answer,
        }
        if model:
            payload["model"] = model
        if self_score is not None:
            payload["self_score"] = int(self_score)
        return await bridge.request("POST", "/v1/grade/short", payload=payload)

    @mcp.tool(name="quiz_explain_mcq", description="Explain why an MCQ answer is right/wrong.", annotations=READ_ONLY)
    async def quiz_explain_mcq(
        provider: str,
        prompt: str,
        options: list[str],
        user_answer: str,
        correct_answer: str,
        model: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "provider": provider,
            "prompt": prompt,
            "options": options,
            "user_answer": user_answer,
            "correct_answer": correct_answer,
        }
        if model:
            payload["model"] = model
        return await bridge.request("POST", "/v1/explain/mcq", payload=payload)

    @mcp.tool(name="quiz_explain_short", description="Explain why a short-answer response is right/wrong.", annotations=READ_ONLY)
    async def quiz_explain_short(
        provider: str,
        question: dict[str, Any],
        user_answer: str,
        model: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "provider": provider,
            "question": question,
            "user_answer": user_answer,
        }
        if model:
            payload["model"] = model
        return await bridge.request("POST", "/v1/explain/short", payload=payload)

    @mcp.tool(name="quiz_history", description="Read quiz attempt history.", annotations=READ_ONLY)
    async def quiz_history(quiz_path: str | None = None) -> dict[str, Any]:
        params = {"quiz_path": quiz_path} if quiz_path else None
        return await bridge.request("GET", "/v1/history", params=params)

    @mcp.tool(name="quiz_append_history", description="Append a quiz attempt to history.", annotations=MUTATING)
    async def quiz_append_history(record: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(record, dict):
            raise ToolError("record must be an object.")
        return await bridge.request("POST", "/v1/history/append", payload=record)

    @mcp.tool(name="quiz_collect_sources", description="Collect generator source files from paths.", annotations=READ_ONLY)
    async def quiz_collect_sources(paths: list[str]) -> dict[str, Any]:
        if not paths:
            raise ToolError("paths must include at least one path.")
        return await bridge.request("POST", "/v1/generate/collect-sources", payload={"paths": paths})

    @mcp.tool(name="quiz_generate", description="Run quiz generation with supplied request payload.", annotations=MUTATING)
    async def quiz_generate(request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict):
            raise ToolError("request must be an object.")
        return await bridge.request("POST", "/v1/generate/run", payload=request)

    return mcp


__all__ = [
    "BackendBridge",
    "BackendConfig",
    "JWTAccessTokenVerifier",
    "MCPAuthConfig",
    "create_mcp_server",
    "_extract_scopes_from_claims",
    "_decode_response_payload",
    "_error_message_from_payload",
    "_normalize_auth_config",
    "_normalize_base_url",
]
