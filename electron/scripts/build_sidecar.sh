#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ELECTRON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ELECTRON_DIR/build/backend"

mkdir -p "$OUT_DIR"

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "pyinstaller is required to build the Python sidecar."
  echo "Install with: python3 -m pip install pyinstaller"
  exit 1
fi

pyinstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name modular-quiz-api \
  --distpath "$OUT_DIR" \
  --workpath "$ELECTRON_DIR/build/pyinstaller-work" \
  --specpath "$ELECTRON_DIR/build/pyinstaller-spec" \
  --add-data "$ROOT_DIR/template_quiz.json:." \
  "$ROOT_DIR/run_api.py"

echo "Built sidecar: $OUT_DIR/modular-quiz-api"
