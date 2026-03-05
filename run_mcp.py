#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os

from quiz_app.mcp import create_mcp_server


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
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    token = str(args.api_token or "").strip()
    if not token:
        raise SystemExit("Missing API token. Provide --api-token or set QUIZ_API_TOKEN.")

    server = create_mcp_server(
        api_base_url=args.api_base_url,
        api_token=token,
        host=args.host,
        port=args.port,
        name=args.name,
    )

    if args.transport == "streamable-http":
        print(f"MCP endpoint: http://{args.host}:{args.port}/mcp")
    elif args.transport == "sse":
        print(f"MCP SSE endpoint: http://{args.host}:{args.port}/sse")
    else:
        print("Starting MCP in stdio mode.")

    server.run(transport=args.transport)


if __name__ == "__main__":
    main()
