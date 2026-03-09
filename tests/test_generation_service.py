from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

from quiz_app.generator.service import _template_path


class GenerationServiceTests(unittest.TestCase):
    def test_template_path_defaults_to_repo_root_template(self) -> None:
        template_path = _template_path()
        self.assertEqual(template_path.name, "template_quiz.json")
        self.assertTrue(template_path.is_file(), "template_quiz.json should exist at the repo root.")

    def test_template_path_uses_meipass_when_packaged(self) -> None:
        with patch("quiz_app.generator.service.sys", create=True) as sys_module:
            sys_module._MEIPASS = "/tmp/frozen-app"
            template_path = _template_path()

        self.assertEqual(template_path, Path("/tmp/frozen-app") / "template_quiz.json")


if __name__ == "__main__":
    unittest.main()
