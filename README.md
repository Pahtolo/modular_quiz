# Modular Quiz

Electron + React desktop app with a Python backend for quiz taking, grading, and quiz generation.

## Current Runtime Targets
- `electron/`: primary desktop UI (default)
- `run_api.py`: local FastAPI backend entrypoint
- `run.py`: optional terminal quiz runner

PySide6 GUI has been removed.

## Quick Start (Electron)
1. Install backend dependencies:
```bash
python3 -m pip install -r requirements-api.txt
```
2. Install frontend dependencies:
```bash
cd electron
npm install
```
3. Run in development:
```bash
cd electron
npm run dev
```

## Backend API (manual)
Run the backend standalone:
```bash
python3 run_api.py --host 127.0.0.1 --port 8766 --token dev-token
```

## MCP Bridge (for ChatGPT Apps / MCP clients)
Run the MCP server that proxies to the backend API routes:
```bash
python3 run_mcp.py --api-base-url http://127.0.0.1:8766 --api-token dev-token
```

Default streamable HTTP endpoint:
```text
http://127.0.0.1:8768/mcp
```

Typical local workflow:
1. Start the backend API (`run_api.py`) and keep its token.
2. Start the MCP bridge (`run_mcp.py`) with the same token.
3. Expose `http://127.0.0.1:8768/mcp` through an HTTPS tunnel when connecting from ChatGPT.
4. Add the HTTPS MCP URL in ChatGPT connector settings.

### OAuth-Protected MCP Mode (ChatGPT account linking)
Enable OAuth verification on the MCP server by providing issuer/resource settings:
```bash
python3 run_mcp.py \
  --api-base-url http://127.0.0.1:8766 \
  --api-token dev-token \
  --auth-issuer-url https://YOUR_AUTH_ISSUER \
  --auth-resource-server-url https://YOUR_PUBLIC_HOST/mcp \
  --auth-audience https://YOUR_PUBLIC_HOST/mcp \
  --auth-required-scopes "quiz.read quiz.write"
```

Notes:
- `--auth-issuer-url` enables OAuth mode.
- `--auth-resource-server-url` must be the publicly reachable MCP URL used by ChatGPT.
- `--auth-jwks-url` is optional; default is `<issuer>/.well-known/jwks.json`.
- The server exposes RFC protected resource metadata at `/.well-known/oauth-protected-resource/...` automatically when OAuth mode is enabled.

## Build and Package (Electron)
Build renderer:
```bash
cd electron
npm run build:renderer
```

Build bundled Python sidecar:
```bash
cd electron
npm run build:sidecar
```

Create macOS package artifact:
```bash
cd electron
npm run dist
```

## Features
- Quiz browser from configured `quiz_roots`
- MCQ + short-answer grading (self, Claude, OpenAI)
- Quiz generation from source material (`.txt`, `.md`, `.docx`, `.pptx`, `.pdf`)
- PDF low-text detection with OCR handoff marker (`needs_ocr`)
- Performance history and attempt drill-down
- Settings persistence and legacy import
- MCP bridge exposing quiz/settings tools over streamable HTTP

## Tests
Run all tests:
```bash
python3 -m unittest discover -s tests -p "test_*.py"
```
