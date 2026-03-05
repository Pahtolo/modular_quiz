from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations


DEFAULT_TOOL_TIMEOUT_SECONDS = 60.0


@dataclass(frozen=True)
class BackendConfig:
    base_url: str
    bearer_token: str
    timeout_seconds: float = DEFAULT_TOOL_TIMEOUT_SECONDS


def _normalize_base_url(value: str) -> str:
    base_url = str(value or "").strip().rstrip("/")
    if not base_url:
        raise ValueError("API base URL is required.")
    if not base_url.startswith(("http://", "https://")):
        raise ValueError("API base URL must start with http:// or https://")
    return base_url


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


READ_ONLY = ToolAnnotations(readOnlyHint=True, idempotentHint=True)
MUTATING = ToolAnnotations(readOnlyHint=False, idempotentHint=False)


def create_mcp_server(
    *,
    api_base_url: str,
    api_token: str,
    host: str = "127.0.0.1",
    port: int = 8768,
    name: str = "modular-quiz",
) -> FastMCP:
    bridge = BackendBridge(
        BackendConfig(
            base_url=api_base_url,
            bearer_token=api_token,
        )
    )
    mcp = FastMCP(
        name=name,
        instructions=(
            "Tools for reading and updating Modular Quiz settings, loading quizzes, "
            "grading answers, running generation, and managing history through the app backend."
        ),
        host=host,
        port=port,
        streamable_http_path="/mcp",
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
    "create_mcp_server",
    "_decode_response_payload",
    "_error_message_from_payload",
    "_normalize_base_url",
]
