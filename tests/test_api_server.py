from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from quiz_app.api.server import create_app
from quiz_app.models import MCQQuestion, Quiz, ShortQuestion


class _StubProvider:
    provider_name = "stub"

    def generate_quiz(
        self,
        materials_text: str,
        title_hint: str,
        instructions_hint: str,
        total_questions: int,
        mcq_count: int,
        short_count: int,
        mcq_options: int,
        model: str | None = None,
    ) -> Quiz:
        self._assertions(
            materials_text,
            total_questions,
            mcq_count,
            short_count,
            mcq_options,
        )
        return Quiz(
            title=title_hint or "Generated Quiz",
            instructions=instructions_hint or "Answer all questions.",
            questions=[
                MCQQuestion(
                    id="q1",
                    prompt="Pick A",
                    points=1,
                    options=["A", "B", "C", "D"],
                    answer="A",
                ),
                ShortQuestion(
                    id="q2",
                    prompt="Say hi",
                    points=2,
                    expected="hi",
                ),
            ],
        )

    @staticmethod
    def _assertions(
        materials_text: str,
        total_questions: int,
        mcq_count: int,
        short_count: int,
        mcq_options: int,
    ) -> None:
        assert "hello from txt" in materials_text
        assert total_questions == 2
        assert mcq_count == 1
        assert short_count == 1
        assert mcq_options == 4


class APIServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

        settings_dir = self.root / "settings"
        settings_dir.mkdir(parents=True, exist_ok=True)
        self.settings_path = settings_dir / "settings.json"

        self.api_token = "test-token"
        app = create_app(
            settings_path=self.settings_path,
            api_token=self.api_token,
            project_root=self.root,
        )
        self.client = TestClient(app)
        self.headers = {"Authorization": f"Bearer {self.api_token}"}

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _post(self, path: str, body: dict) -> dict:
        response = self.client.post(path, headers=self.headers, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_health_requires_auth(self) -> None:
        unauthorized = self.client.get("/v1/health")
        self.assertEqual(unauthorized.status_code, 401)

        ok = self.client.get("/v1/health", headers=self.headers)
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(ok.json()["ok"])

    def test_settings_round_trip(self) -> None:
        initial = self.client.get("/v1/settings", headers=self.headers)
        self.assertEqual(initial.status_code, 200)
        settings = initial.json()["settings"]
        self.assertIn("quiz_roots", settings)

        updated = self.client.put(
            "/v1/settings",
            headers=self.headers,
            json={
                "quiz_dir": str(self.root / "Algorithm Analysis"),
                "quiz_roots": [str(self.root)],
                "feedback_mode": "end_only",
                "question_timer_seconds": 45,
                "generation_defaults": {
                    "total": 10,
                    "mcq_count": 7,
                    "short_count": 3,
                    "mcq_options": 4,
                },
            },
        )
        self.assertEqual(updated.status_code, 200)
        payload = updated.json()["settings"]
        self.assertEqual(payload["feedback_mode"], "end_only")
        self.assertFalse(payload["show_feedback_on_answer"])
        self.assertTrue(payload["show_feedback_on_completion"])
        self.assertFalse(payload["auto_advance_enabled"])
        self.assertEqual(payload["question_timer_seconds"], 45)
        self.assertEqual(payload["quiz_roots"], [str((self.root / "Quizzes").resolve())])

        flags_update = self.client.put(
            "/v1/settings",
            headers=self.headers,
            json={
                "show_feedback_on_answer": True,
                "show_feedback_on_completion": False,
                "auto_advance_enabled": True,
            },
        )
        self.assertEqual(flags_update.status_code, 200)
        flags_payload = flags_update.json()["settings"]
        self.assertEqual(flags_payload["feedback_mode"], "auto_advance")
        self.assertTrue(flags_payload["show_feedback_on_answer"])
        self.assertFalse(flags_payload["show_feedback_on_completion"])
        self.assertTrue(flags_payload["auto_advance_enabled"])

    def test_quiz_tree_and_load(self) -> None:
        quiz_dir = self.root / "Algorithm Analysis"
        quiz_dir.mkdir(parents=True, exist_ok=True)
        quiz_path = quiz_dir / "sample.json"
        nested_dir = quiz_dir / "week1"
        nested_dir.mkdir(parents=True, exist_ok=True)
        nested_quiz_path = nested_dir / "nested.json"
        ignored_file = nested_dir / "notes.txt"
        ignored_file.write_text("ignore me", encoding="utf-8")

        quiz_path.write_text(
            json.dumps(
                {
                    "title": "Sample Quiz",
                    "instructions": "Answer all questions.",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "2+2?",
                            "options": ["3", "4"],
                            "answer": "B",
                            "points": 1,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        nested_quiz_path.write_text(
            json.dumps(
                {
                    "title": "Nested Quiz",
                    "instructions": "Answer all questions.",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "1+1?",
                            "options": ["1", "2"],
                            "answer": "B",
                            "points": 1,
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        self.client.put(
            "/v1/settings",
            headers=self.headers,
            json={"quiz_roots": [str(self.root)]},
        )

        tree = self._post("/v1/quizzes/tree", {"quiz_roots": [str(self.root)]})
        self.assertTrue(tree["roots"])
        root_node = tree["roots"][0]
        self.assertEqual(root_node["kind"], "root")

        def _collect(nodes: list[dict], kind: str, field: str) -> set[str]:
            values: set[str] = set()
            for node in nodes:
                if node.get("kind") == kind:
                    value = node.get(field)
                    if isinstance(value, str):
                        values.add(value)
                values.update(_collect(node.get("children", []), kind, field))
            return values

        folder_names = _collect(root_node["children"], "folder", "name")
        self.assertIn("Algorithm Analysis", folder_names)
        self.assertIn("week1", folder_names)

        child_names = _collect(root_node["children"], "quiz", "name")
        self.assertIn("Sample Quiz", child_names)
        self.assertIn("Nested Quiz", child_names)

        child_rel_paths = _collect(root_node["children"], "quiz", "relative_path")
        self.assertIn("Algorithm Analysis/sample.json", child_rel_paths)
        self.assertIn("Algorithm Analysis/week1/nested.json", child_rel_paths)
        self.assertNotIn("Algorithm Analysis/week1/notes.txt", child_rel_paths)

        loaded = self._post("/v1/quizzes/load", {"path": str(quiz_path)})
        self.assertEqual(loaded["quiz"]["title"], "Sample Quiz")

        invalid = self.client.post(
            "/v1/quizzes/load",
            headers=self.headers,
            json={"path": str(self.root / "missing.json")},
        )
        self.assertEqual(invalid.status_code, 404)

    def test_quiz_tree_multiple_roots_distinct_paths(self) -> None:
        root_one = self.root / "coursesA" / "quizzes"
        root_two = self.root / "coursesB" / "quizzes"
        root_one.mkdir(parents=True, exist_ok=True)
        root_two.mkdir(parents=True, exist_ok=True)

        (root_one / "a.json").write_text(
            json.dumps(
                {
                    "title": "A",
                    "instructions": "",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "A?",
                            "options": ["A", "B"],
                            "answer": "A",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        (root_two / "b.json").write_text(
            json.dumps(
                {
                    "title": "B",
                    "instructions": "",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "B?",
                            "options": ["A", "B"],
                            "answer": "B",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        tree = self._post(
            "/v1/quizzes/tree",
            {"quiz_roots": [str(root_one), str(root_two)]},
        )
        self.assertEqual(len(tree["roots"]), 2)
        root_names = {node["name"] for node in tree["roots"]}
        self.assertEqual(root_names, {str(root_one.resolve()), str(root_two.resolve())})
        for node in tree["roots"]:
            self.assertEqual(node["kind"], "root")
            self.assertEqual(len(node["children"]), 1)
            self.assertEqual(node["children"][0]["kind"], "quiz")
            self.assertTrue(node["children"][0]["path"].lower().endswith(".json"))

    def test_quizzes_library_import_and_structure(self) -> None:
        source_folder = self.root / "source-quizzes"
        nested = source_folder / "week1"
        nested.mkdir(parents=True, exist_ok=True)

        (source_folder / "intro.json").write_text(
            json.dumps(
                {
                    "name": "Intro Display Name",
                    "title": "Intro",
                    "instructions": "",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "A?",
                            "options": ["A", "B"],
                            "answer": "A",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        (nested / "deep.json").write_text(
            json.dumps(
                {
                    "title": "Deep",
                    "instructions": "",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "B?",
                            "options": ["A", "B"],
                            "answer": "B",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        (nested / "ignore.txt").write_text("ignore", encoding="utf-8")

        library = self.client.get("/v1/quizzes/library", headers=self.headers)
        self.assertEqual(library.status_code, 200, library.text)
        quizzes_dir = Path(library.json()["quizzes_dir"])
        self.assertTrue(quizzes_dir.exists())
        self.assertEqual(quizzes_dir, (self.root / "Quizzes").resolve())
        self.assertEqual(library.json()["settings"]["quiz_roots"], [str(quizzes_dir)])

        imported = self._post(
            "/v1/quizzes/library/import",
            {"source_paths": [str(source_folder)]},
        )
        self.assertEqual(imported["imported_files"], 2)
        self.assertFalse(imported["warnings"], imported["warnings"])
        self.assertEqual(imported["settings"]["quiz_roots"], [str(quizzes_dir)])

        def _collect_quiz_names(nodes: list[dict]) -> list[str]:
            names: list[str] = []
            for node in nodes:
                if node.get("kind") == "quiz":
                    names.append(str(node.get("name", "")))
                names.extend(_collect_quiz_names(node.get("children", [])))
            return names

        quiz_names = _collect_quiz_names(imported["tree"])
        self.assertIn("Intro", quiz_names)
        self.assertIn("Deep", quiz_names)

        tree_default = self._post("/v1/quizzes/tree", {})
        self.assertTrue(tree_default["roots"])
        default_root = tree_default["roots"][0]
        self.assertEqual(default_root["path"], str(quizzes_dir))

        def _collect_quiz_rel_paths(nodes: list[dict]) -> set[str]:
            values: set[str] = set()
            for node in nodes:
                if node.get("kind") == "quiz":
                    rel = node.get("relative_path")
                    if isinstance(rel, str):
                        values.add(rel)
                values.update(_collect_quiz_rel_paths(node.get("children", [])))
            return values

        default_paths = _collect_quiz_rel_paths(default_root["children"])
        self.assertIn(f"{source_folder.name}/intro.json", default_paths)
        self.assertIn(f"{source_folder.name}/week1/deep.json", default_paths)

    def test_quizzes_library_rename_updates_json_title(self) -> None:
        quizzes_dir = self.root / "Quizzes"
        quizzes_dir.mkdir(parents=True, exist_ok=True)
        quiz_path = quizzes_dir / "rename-me.json"
        quiz_path.write_text(
            json.dumps(
                {
                    "title": "Old Title",
                    "instructions": "Answer all questions.",
                    "questions": [
                        {
                            "type": "mcq",
                            "id": "q1",
                            "prompt": "A?",
                            "options": ["A", "B"],
                            "answer": "A",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

        renamed = self._post(
            "/v1/quizzes/library/rename",
            {
                "path": str(quiz_path),
                "title": "New Title",
            },
        )
        self.assertEqual(renamed["path"], str(quiz_path.resolve()))
        self.assertEqual(renamed["title"], "New Title")

        saved = json.loads(quiz_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["title"], "New Title")

        tree = self._post("/v1/quizzes/tree", {})
        root = tree["roots"][0]
        quiz_titles = [node["name"] for node in root["children"] if node.get("kind") == "quiz"]
        self.assertIn("New Title", quiz_titles)

    def test_grading_endpoints(self) -> None:
        mcq = self._post(
            "/v1/grade/mcq",
            {
                "question": {
                    "id": "q1",
                    "prompt": "2+2?",
                    "options": ["3", "4"],
                    "answer": "B",
                    "points": 1,
                },
                "user_answer": "B",
            },
        )
        self.assertTrue(mcq["result"]["correct"])

        short_self = self._post(
            "/v1/grade/short",
            {
                "provider": "self",
                "question": {
                    "id": "q2",
                    "prompt": "Say hi",
                    "expected": "hi",
                    "points": 2,
                },
                "user_answer": "hello",
                "self_score": 1,
            },
        )
        self.assertEqual(short_self["result"]["points_awarded"], 1)

    def test_history_append_and_filter(self) -> None:
        record = {
            "timestamp": "2026-03-04T10:00:00",
            "quiz_path": str(self.root / "q.json"),
            "quiz_title": "Q",
            "score": 3,
            "max_score": 4,
            "percent": 75.0,
            "duration_seconds": 12.0,
            "model_key": "self:",
            "questions": [
                {
                    "question_id": "q1",
                    "question_type": "mcq",
                    "user_answer": "A",
                    "correct_answer_or_expected": "A",
                    "points_awarded": 1,
                    "max_points": 1,
                    "feedback": "Correct.",
                }
            ],
        }
        append_resp = self._post("/v1/history/append", record)
        self.assertTrue(append_resp["ok"])

        history = self.client.get("/v1/history", headers=self.headers)
        self.assertEqual(history.status_code, 200)
        records = history.json()["records"]
        self.assertEqual(len(records), 1)

        filtered = self.client.get(
            "/v1/history",
            headers=self.headers,
            params={"quiz_path": str(self.root / "q.json")},
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()["records"]), 1)

    def test_collect_sources_and_generate_run(self) -> None:
        docs = self.root / "docs"
        docs.mkdir(parents=True, exist_ok=True)
        txt_path = docs / "notes.txt"
        txt_path.write_text("hello from txt", encoding="utf-8")
        unsupported = docs / "skip.bin"
        unsupported.write_bytes(b"\x00\x01")

        pdf_path = docs / "blank.pdf"
        try:
            from pypdf import PdfWriter

            writer = PdfWriter()
            writer.add_blank_page(width=72, height=72)
            with pdf_path.open("wb") as fh:
                writer.write(fh)
        except Exception:
            pdf_path.write_bytes(b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF")

        collect = self._post(
            "/v1/generate/collect-sources",
            {"paths": [str(docs)]},
        )
        self.assertGreaterEqual(len(collect["sources"]), 2)
        self.assertTrue(any("Unsupported file extension" in w for w in collect["warnings"]))

        with patch("quiz_app.api.server._provider_client", return_value=_StubProvider()):
            generated = self._post(
                "/v1/generate/run",
                {
                    "quiz_dir": str(self.root),
                    "sources": collect["sources"],
                    "provider": "claude",
                    "model": "stub-model",
                    "total": 2,
                    "mcq_count": 1,
                    "short_count": 1,
                    "mcq_options": 4,
                    "title_hint": "API Generated",
                },
            )

        self.assertTrue(generated["ok"], generated.get("errors"))
        self.assertTrue(generated["output_path"])
        self.assertTrue(Path(generated["output_path"]).exists())

        pdf_materials = [m for m in generated["extracted_materials"] if m["path"].endswith(".pdf")]
        self.assertEqual(len(pdf_materials), 1)
        self.assertTrue(pdf_materials[0]["needs_ocr"])


if __name__ == "__main__":
    unittest.main()
