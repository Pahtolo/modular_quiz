from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from quiz_app.generator.extractors import _extract_pdf, collect_sources


def _make_blank_pdf(path: Path) -> None:
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    with path.open("wb") as fh:
        writer.write(fh)


class ExtractorTests(unittest.TestCase):
    def test_collect_sources_marks_folder_scan_and_recurses(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            docs = root / "docs"
            nested = docs / "week1"
            nested.mkdir(parents=True, exist_ok=True)
            (docs / "a.txt").write_text("alpha", encoding="utf-8")
            (nested / "b.md").write_text("beta", encoding="utf-8")

            sources, warnings = collect_sources([docs])

            self.assertFalse(warnings)
            self.assertEqual(len(sources), 2)
            self.assertTrue(all(src.source_kind == "folder_scan" for src in sources))
            collected_names = {src.path.name for src in sources}
            self.assertEqual(collected_names, {"a.txt", "b.md"})

    def test_collect_sources_marks_direct_files_as_file_kind(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            txt = root / "standalone.txt"
            txt.write_text("hello", encoding="utf-8")

            sources, warnings = collect_sources([txt])

            self.assertFalse(warnings)
            self.assertEqual(len(sources), 1)
            self.assertEqual(sources[0].source_kind, "file")

    def test_extract_pdf_uses_ocr_text_when_pdf_text_is_low(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "blank.pdf"
            _make_blank_pdf(pdf_path)

            with patch(
                "quiz_app.generator.extractors.ocr_pdf",
                return_value=("Detected OCR text", ["ocr warning"]),
            ):
                material = _extract_pdf(pdf_path, min_chars_for_text=9999)

            self.assertEqual(material.extracted_by, "pdf+ocr")
            self.assertFalse(material.needs_ocr)
            self.assertIn("Detected OCR text", material.content)
            self.assertTrue(any("OCR fallback applied" in warning for warning in material.warnings))
            self.assertIn("ocr warning", material.warnings)

    def test_extract_pdf_warns_when_ocr_fallback_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "blank.pdf"
            _make_blank_pdf(pdf_path)

            with patch(
                "quiz_app.generator.extractors.ocr_pdf",
                side_effect=RuntimeError("missing OCR binaries"),
            ):
                material = _extract_pdf(pdf_path, min_chars_for_text=9999)

            self.assertEqual(material.extracted_by, "pdf")
            self.assertTrue(material.needs_ocr)
            self.assertTrue(any("OCR fallback failed" in warning for warning in material.warnings))


if __name__ == "__main__":
    unittest.main()
