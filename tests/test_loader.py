from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from quiz_app.loader import load_quiz
from quiz_app.models import QuizValidationError


class LoaderTests(unittest.TestCase):
    def test_load_quiz_rejects_whitespace_only_mcq_options(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            quiz_path = Path(tmp) / "blank-options.json"
            quiz_path.write_text(
                json.dumps(
                    {
                        "title": "Whitespace Options",
                        "instructions": "Answer all questions.",
                        "questions": [
                            {
                                "type": "mcq",
                                "id": "q1",
                                "prompt": "Pick one",
                                "options": ["   ", "Valid option"],
                                "answer": "B",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(QuizValidationError, "options"):
                load_quiz(quiz_path)


if __name__ == "__main__":
    unittest.main()
