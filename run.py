#!/usr/bin/env python3
import argparse
import getpass
import os
from pathlib import Path

from quiz_app.discovery import discover_quizzes, display_quiz_name, resolve_quiz_path
from quiz_app.engine import QuizRunner
from quiz_app.graders import ClaudeShortGrader, SelfShortGrader
from quiz_app.loader import load_quiz
from quiz_app.models import QuizValidationError
from quiz_app.openai_client import OpenAIAuthState, OpenAIClient

def choose_quiz_path(quiz_dir: Path, quiz_arg: str | None) -> Path:
    if quiz_arg:
        return resolve_quiz_path(quiz_dir, quiz_arg)

    files = discover_quizzes(quiz_dir)
    if not files:
        raise FileNotFoundError(f"No quiz JSON files found in {quiz_dir}")

    print("Available quizzes:")
    for i, f in enumerate(files, start=1):
        print(f"  {i}. {display_quiz_name(f, quiz_dir)}")

    while True:
        try:
            choice = input("Choose a quiz number: ").strip()
        except EOFError:
            raise SystemExit("\nNo selection provided.")
        if choice.isdigit():
            idx = int(choice)
            if 1 <= idx <= len(files):
                return files[idx - 1]
        print("Invalid selection. Enter a listed number.")


class OpenAIShortGrader:
    def __init__(self, api_key: str, model: str):
        self.client = OpenAIClient(
            auth=OpenAIAuthState(api_key=api_key),
            default_model=model,
        )
        self.model = model

    def grade(self, question, user_answer: str):
        return self.client.grade_short(question, user_answer, model=self.model)


def main() -> None:
    base_dir = Path(__file__).resolve().parent
    legacy_quiz_dir = base_dir / "quizzes"
    default_quiz_dir = legacy_quiz_dir if legacy_quiz_dir.exists() else base_dir

    parser = argparse.ArgumentParser(description="Modular terminal quiz runner.")
    parser.add_argument("--quiz", help="Quiz file path or partial filename match.")
    parser.add_argument("--quiz-dir", default=str(default_quiz_dir), help="Directory containing quiz JSON files.")
    parser.add_argument("--list", action="store_true", help="List discovered quizzes and exit.")
    parser.add_argument(
        "--short-grader",
        choices=["claude", "self", "openai"],
        default="claude",
        help="Short-answer grading mode (default: claude).",
    )
    parser.add_argument("--claude-model", default="claude-3-5-haiku-latest")
    parser.add_argument("--anthropic-api-key", help="Claude API key override.")
    parser.add_argument("--openai-model", default="gpt-5-mini")
    parser.add_argument("--openai-api-key", help="OpenAI API key override.")
    parser.add_argument("--debug-env", action="store_true", help="Show resolved key source details.")
    parser.add_argument("--check-env", action="store_true", help="Check key resolution and exit.")
    args = parser.parse_args()

    quiz_dir = Path(args.quiz_dir).expanduser().resolve()
    claude_key = args.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY")
    if claude_key:
        claude_key = claude_key.strip()
    openai_key = args.openai_api_key or os.getenv("OPENAI_API_KEY")
    if openai_key:
        openai_key = openai_key.strip()

    if args.debug_env:
        claude_source = "none"
        if args.anthropic_api_key:
            claude_source = "--anthropic-api-key"
        elif os.getenv("ANTHROPIC_API_KEY"):
            claude_source = "ANTHROPIC_API_KEY"
        elif os.getenv("CLAUDE_API_KEY"):
            claude_source = "CLAUDE_API_KEY"
        openai_source = "--openai-api-key" if args.openai_api_key else ("OPENAI_API_KEY" if os.getenv("OPENAI_API_KEY") else "none")
        print(f"Debug: short-grader={args.short_grader}")
        print(f"Debug: claude key source={claude_source}")
        print(f"Debug: claude key detected={'yes' if bool(claude_key) else 'no'}")
        print(f"Debug: openai key source={openai_source}")
        print(f"Debug: openai key detected={'yes' if bool(openai_key) else 'no'}")
        if claude_key:
            print(f"Debug: claude key prefix={claude_key[:8]}...")
        if openai_key:
            print(f"Debug: openai key prefix={openai_key[:8]}...")

    if args.check_env:
        return

    if args.list:
        for f in discover_quizzes(quiz_dir):
            print(display_quiz_name(f, quiz_dir))
        return

    if args.short_grader == "claude" and not claude_key:
        try:
            claude_key = getpass.getpass("Claude API key not found. Paste key (input hidden): ").strip()
        except EOFError:
            raise SystemExit("\nNo key provided. Exiting.")
        if not claude_key:
            raise SystemExit("No key provided. Exiting.")

    if args.short_grader == "openai" and not openai_key:
        try:
            openai_key = getpass.getpass("OpenAI API key not found. Paste key (input hidden): ").strip()
        except EOFError:
            raise SystemExit("\nNo key provided. Exiting.")
        if not openai_key:
            raise SystemExit("No key provided. Exiting.")

    quiz_path = choose_quiz_path(quiz_dir, args.quiz)

    try:
        quiz = load_quiz(quiz_path)
    except QuizValidationError as e:
        raise SystemExit(f"Invalid quiz file: {e}")

    if args.short_grader == "claude":
        short_grader = ClaudeShortGrader(api_key=claude_key, model=args.claude_model)
    elif args.short_grader == "openai":
        short_grader = OpenAIShortGrader(api_key=openai_key, model=args.openai_model)
    else:
        short_grader = SelfShortGrader()

    runner = QuizRunner()
    runner.run(quiz, short_grader=short_grader)


if __name__ == "__main__":
    main()
