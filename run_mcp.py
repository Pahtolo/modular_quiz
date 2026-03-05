#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
from urllib.parse import urlparse

from quiz_app.mcp import MCPAuthConfig, create_mcp_server


def _split_scopes(value: str | None) -> tuple[str, ...]:
    raw = str(value or "").replace(",", " ")
    return tuple(dict.fromkeys([chunk for chunk in raw.split() if chunk]))


def _protected_resource_metadata_url(resource_server_url: str) -> str:
    parsed = urlparse(str(resource_server_url).strip())
    resource_path = parsed.path if parsed.path != "/" else ""
    return f"{parsed.scheme}://{parsed.netloc}/.well-known/oauth-protected-resource{resource_path}"


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Modular Quiz MCP bridge server.")
    parser.add_argument(
        "--api-base-url",
        default=os.getenv("QUIZ_API_BASE_URL", "http://127.0.0.1:8766"),
        help="Base URL for the local Modular Quiz HTTP API.",
    )
    parser.add_argument(
        "--api-token",
        default=os.getenv("QUIZ_API_TOKEN") or os.getenv("API_TOKEN", ""),
        help="Bearer token used to call the backend API. Can also be set via QUIZ_API_TOKEN.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind MCP server.")
    parser.add_argument("--port", type=int, default=8768, help="Port to bind MCP server.")
    parser.add_argument(
        "--transport",
        choices=["stdio", "sse", "streamable-http"],
        default="streamable-http",
        help="MCP transport. Use streamable-http for ChatGPT connector URLs.",
    )
    parser.add_argument(
        "--name",
        default="modular-quiz",
        help="Server display name exposed to MCP clients.",
    )
    parser.add_argument(
        "--auth-issuer-url",
        default=os.getenv("QUIZ_MCP_AUTH_ISSUER_URL", ""),
        help="OAuth issuer URL for ChatGPT connector sign-in (for example https://YOUR_DOMAIN.auth0.com).",
    )
    parser.add_argument(
        "--auth-resource-server-url",
        default=os.getenv("QUIZ_MCP_AUTH_RESOURCE_SERVER_URL", ""),
        help=(
            "Public MCP resource URL used in oauth-protected-resource metadata "
            "(for example https://your-public-host/mcp)."
        ),
    )
    parser.add_argument(
        "--auth-audience",
        default=os.getenv("QUIZ_MCP_AUTH_AUDIENCE", ""),
        help="JWT audience value expected in access tokens. Defaults to auth-resource-server-url.",
    )
    parser.add_argument(
        "--auth-jwks-url",
        default=os.getenv("QUIZ_MCP_AUTH_JWKS_URL", ""),
        help="JWKS URL used to verify OAuth access tokens. Defaults to <issuer>/.well-known/jwks.json.",
    )
    parser.add_argument(
        "--auth-required-scopes",
        default=os.getenv("QUIZ_MCP_AUTH_REQUIRED_SCOPES", ""),
        help="Optional required OAuth scopes (comma/space separated), for example 'quiz.read quiz.write'.",
    )
    parser.add_argument(
        "--auth-service-documentation-url",
        default=os.getenv("QUIZ_MCP_AUTH_SERVICE_DOC_URL", ""),
        help="Optional service documentation URL surfaced in authorization metadata.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    token = str(args.api_token or "").strip()
    if not token:
        raise SystemExit("Missing API token. Provide --api-token or set QUIZ_API_TOKEN.")

    auth_config = None
    issuer_url = str(args.auth_issuer_url or "").strip()
    resource_server_url = str(args.auth_resource_server_url or "").strip()
    if issuer_url:
        if not resource_server_url and args.transport == "streamable-http":
            resource_server_url = f"http://{args.host}:{args.port}/mcp"
        if not resource_server_url:
            raise SystemExit(
                "Missing auth resource server URL. Provide --auth-resource-server-url when --auth-issuer-url is set."
            )

        auth_config = MCPAuthConfig(
            issuer_url=issuer_url,
            resource_server_url=resource_server_url,
            audience=str(args.auth_audience or "").strip(),
            jwks_url=str(args.auth_jwks_url or "").strip(),
            required_scopes=_split_scopes(args.auth_required_scopes),
            service_documentation_url=str(args.auth_service_documentation_url or "").strip(),
        )

    server = create_mcp_server(
        api_base_url=args.api_base_url,
        api_token=token,
        host=args.host,
        port=args.port,
        name=args.name,
        auth_config=auth_config,
    )

    if args.transport == "streamable-http":
        print(f"MCP endpoint: http://{args.host}:{args.port}/mcp")
    elif args.transport == "sse":
        print(f"MCP SSE endpoint: http://{args.host}:{args.port}/sse")
    else:
        print("Starting MCP in stdio mode.")

    if auth_config:
        metadata_url = _protected_resource_metadata_url(auth_config.resource_server_url)
        print(f"OAuth enabled. Issuer: {auth_config.issuer_url}")
        print(f"OAuth protected resource metadata: {metadata_url}")
        if auth_config.required_scopes:
            print(f"OAuth required scopes: {', '.join(auth_config.required_scopes)}")

    server.run(transport=args.transport)


if __name__ == "__main__":
    main()
