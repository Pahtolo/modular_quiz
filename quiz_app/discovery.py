from pathlib import Path
from typing import List, Optional


def discover_quizzes(quiz_dir: Path) -> List[Path]:
    if not quiz_dir.exists():
        return []
    return sorted(
        p
        for p in quiz_dir.rglob("*.json")
        if p.is_file() and not (p.parent.name == "settings" and p.name == "settings.json")
    )


def display_quiz_name(path: Path, quiz_dir: Path) -> str:
    try:
        return str(path.relative_to(quiz_dir))
    except ValueError:
        return path.name


def resolve_quiz_path(quiz_dir: Path, quiz_arg: Optional[str]) -> Path:
    files = discover_quizzes(quiz_dir)
    if not files:
        raise FileNotFoundError(f"No quiz JSON files found in {quiz_dir}")

    if quiz_arg:
        direct = Path(quiz_arg).expanduser()
        if direct.exists() and direct.is_file():
            return direct.resolve()

        query = quiz_arg.lower()
        matches = [
            f
            for f in files
            if query in f.name.lower() or query in display_quiz_name(f, quiz_dir).lower()
        ]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            names = "\n".join(f"- {display_quiz_name(m, quiz_dir)}" for m in matches)
            raise ValueError(f"Multiple quizzes match '{quiz_arg}':\n{names}")
        raise ValueError(f"No quiz matching '{quiz_arg}'.")

    raise ValueError("Quiz argument is required for non-interactive resolution.")
