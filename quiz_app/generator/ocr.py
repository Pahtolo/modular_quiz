from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def _runtime_env() -> dict[str, str]:
    env = dict(os.environ)

    ocr_bin_dir = str(env.get("OCR_BIN_DIR", "")).strip()
    if ocr_bin_dir:
        existing_path = env.get("PATH", "")
        env["PATH"] = f"{ocr_bin_dir}{os.pathsep}{existing_path}" if existing_path else ocr_bin_dir

    tessdata_prefix = str(env.get("TESSDATA_PREFIX", "")).strip()
    if tessdata_prefix:
        env["TESSDATA_PREFIX"] = tessdata_prefix

    return env


def _binary_candidates(name: str) -> list[str]:
    names = [name]
    if os.name == "nt" and not name.lower().endswith(".exe"):
        names.insert(0, f"{name}.exe")
    return names


def _require_binary(name: str, env: dict[str, str]) -> str:
    ocr_bin_dir = str(env.get("OCR_BIN_DIR", "")).strip()
    for candidate in _binary_candidates(name):
        if ocr_bin_dir:
            bundled_path = Path(ocr_bin_dir) / candidate
            if bundled_path.exists():
                return str(bundled_path)
        resolved = shutil.which(candidate, path=env.get("PATH"))
        if resolved:
            return resolved

    raise RuntimeError(
        f"Required OCR binary '{name}' not found. Set OCR_BIN_DIR or install OCR runtime dependencies."
    )


def ocr_pdf(path: Path) -> tuple[str, list[str]]:
    env = _runtime_env()
    pdftoppm_bin = _require_binary("pdftoppm", env)
    tesseract_bin = _require_binary("tesseract", env)

    warnings: list[str] = []
    lines: list[str] = []

    with tempfile.TemporaryDirectory(prefix="quiz_ocr_") as td:
        tmp_dir = Path(td)
        prefix = tmp_dir / "page"

        pdftoppm_cmd = [
            pdftoppm_bin,
            "-png",
            str(path),
            str(prefix),
        ]
        run = subprocess.run(pdftoppm_cmd, capture_output=True, text=True, env=env)
        if run.returncode != 0:
            raise RuntimeError(f"pdftoppm failed: {run.stderr.strip() or run.stdout.strip()}")

        images = sorted(tmp_dir.glob("page-*.png"))
        if not images:
            warnings.append("OCR found no rasterized pages.")
            return "", warnings

        for image in images:
            tesseract_cmd = [tesseract_bin, str(image), "stdout"]
            out = subprocess.run(tesseract_cmd, capture_output=True, text=True, env=env)
            if out.returncode != 0:
                warnings.append(f"tesseract failed on {image.name}: {out.stderr.strip()}")
                continue
            text = (out.stdout or "").strip()
            if text:
                lines.append(text)

    return "\n\n".join(lines).strip(), warnings
