from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


def _require_binary(name: str) -> None:
    if shutil.which(name):
        return
    raise RuntimeError(f"Required binary '{name}' not found. Install with Homebrew dependency installer.")


def ocr_pdf(path: Path) -> tuple[str, list[str]]:
    _require_binary("pdftoppm")
    _require_binary("tesseract")

    warnings: list[str] = []
    lines: list[str] = []

    with tempfile.TemporaryDirectory(prefix="quiz_ocr_") as td:
        tmp_dir = Path(td)
        prefix = tmp_dir / "page"

        pdftoppm_cmd = [
            "pdftoppm",
            "-png",
            str(path),
            str(prefix),
        ]
        run = subprocess.run(pdftoppm_cmd, capture_output=True, text=True)
        if run.returncode != 0:
            raise RuntimeError(f"pdftoppm failed: {run.stderr.strip() or run.stdout.strip()}")

        images = sorted(tmp_dir.glob("page-*.png"))
        if not images:
            warnings.append("OCR found no rasterized pages.")
            return "", warnings

        for image in images:
            tesseract_cmd = ["tesseract", str(image), "stdout"]
            out = subprocess.run(tesseract_cmd, capture_output=True, text=True)
            if out.returncode != 0:
                warnings.append(f"tesseract failed on {image.name}: {out.stderr.strip()}")
                continue
            text = (out.stdout or "").strip()
            if text:
                lines.append(text)

    return "\n\n".join(lines).strip(), warnings
