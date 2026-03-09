from __future__ import annotations

import unittest

from scripts.pr_review_helper import build_pr_status
from scripts.pr_review_helper import parse_remote_slug


class PRReviewHelperTests(unittest.TestCase):
    def test_parse_remote_slug_supports_common_formats(self) -> None:
        self.assertEqual(parse_remote_slug("https://github.com/Pahtolo/modular_quiz.git"), "Pahtolo/modular_quiz")
        self.assertEqual(parse_remote_slug("git@github.com:Pahtolo/modular_quiz.git"), "Pahtolo/modular_quiz")
        self.assertEqual(parse_remote_slug("ssh://git@github.com/Pahtolo/modular_quiz.git"), "Pahtolo/modular_quiz")

    def test_build_pr_status_returns_no_pr_when_branch_has_none(self) -> None:
        status = build_pr_status(
            {"data": {"repository": {"pullRequests": {"nodes": []}}}},
            owner="Pahtolo",
            repo="modular_quiz",
        )
        self.assertFalse(status["has_open_pr"])
        self.assertEqual(status["unresolved_count"], 0)
        self.assertEqual(status["unresolved_threads"], [])

    def test_build_pr_status_ignores_resolved_and_outdated_threads(self) -> None:
        status = build_pr_status(
            {
                "data": {
                    "repository": {
                        "pullRequests": {
                            "nodes": [
                                {
                                    "number": 14,
                                    "title": "Fix short-answer points validation",
                                    "url": "https://github.com/Pahtolo/modular_quiz/pull/14",
                                    "isDraft": False,
                                    "reviewDecision": "CHANGES_REQUESTED",
                                    "headRefName": "codex/fix-short-question-points-validation",
                                    "headRepository": {"name": "modular_quiz"},
                                    "headRepositoryOwner": {"login": "Pahtolo"},
                                    "baseRefName": "master",
                                    "reviewThreads": {
                                        "nodes": [
                                            {
                                                "isResolved": False,
                                                "isOutdated": False,
                                                "path": "quiz_app/api/server.py",
                                                "line": 780,
                                                "comments": {
                                                    "nodes": [
                                                        {
                                                            "author": {"login": "codex-reviewer"},
                                                            "body": "Reject fractional floats instead of truncating them.",
                                                            "createdAt": "2026-03-08T22:20:00Z",
                                                            "url": "https://example.com/thread/1",
                                                        }
                                                    ]
                                                },
                                            },
                                            {
                                                "isResolved": True,
                                                "isOutdated": False,
                                                "path": "tests/test_api_server.py",
                                                "line": 900,
                                                "comments": {"nodes": []},
                                            },
                                            {
                                                "isResolved": False,
                                                "isOutdated": True,
                                                "path": "FEATURE_TRACKER.md",
                                                "line": 91,
                                                "comments": {"nodes": []},
                                            },
                                        ]
                                    },
                                }
                            ]
                        }
                    }
                }
            }
            ,
            owner="Pahtolo",
            repo="modular_quiz",
        )
        self.assertTrue(status["has_open_pr"])
        self.assertEqual(status["pull_request"]["number"], 14)
        self.assertEqual(status["unresolved_count"], 1)
        self.assertEqual(status["unresolved_threads"][0]["path"], "quiz_app/api/server.py")
        self.assertEqual(status["unresolved_threads"][0]["line"], 780)
        self.assertEqual(status["unresolved_threads"][0]["author"], "codex-reviewer")

    def test_build_pr_status_ignores_same_branch_name_from_other_repo_owner(self) -> None:
        status = build_pr_status(
            {
                "data": {
                    "repository": {
                        "pullRequests": {
                            "nodes": [
                                {
                                    "number": 99,
                                    "title": "Fork PR with same branch name",
                                    "url": "https://github.com/Pahtolo/modular_quiz/pull/99",
                                    "isDraft": False,
                                    "reviewDecision": "COMMENTED",
                                    "headRefName": "codex/pr-review-helper",
                                    "headRepository": {"name": "modular_quiz"},
                                    "headRepositoryOwner": {"login": "someone-else"},
                                    "baseRefName": "master",
                                    "reviewThreads": {"nodes": []},
                                },
                                {
                                    "number": 15,
                                    "title": "Add PR review loop helper",
                                    "url": "https://github.com/Pahtolo/modular_quiz/pull/15",
                                    "isDraft": False,
                                    "reviewDecision": "COMMENTED",
                                    "headRefName": "codex/pr-review-helper",
                                    "headRepository": {"name": "modular_quiz"},
                                    "headRepositoryOwner": {"login": "Pahtolo"},
                                    "baseRefName": "master",
                                    "reviewThreads": {"nodes": []},
                                },
                            ]
                        }
                    }
                }
            },
            owner="Pahtolo",
            repo="modular_quiz",
        )
        self.assertTrue(status["has_open_pr"])
        self.assertEqual(status["pull_request"]["number"], 15)

    def test_build_pr_status_matches_repo_and_owner_case_insensitively(self) -> None:
        status = build_pr_status(
            {
                "data": {
                    "repository": {
                        "pullRequests": {
                            "nodes": [
                                {
                                    "number": 15,
                                    "title": "Add PR review loop helper",
                                    "url": "https://github.com/Pahtolo/modular_quiz/pull/15",
                                    "isDraft": False,
                                    "reviewDecision": "COMMENTED",
                                    "headRefName": "codex/pr-review-helper",
                                    "headRepository": {"name": "Modular_Quiz"},
                                    "headRepositoryOwner": {"login": "PAHTOLO"},
                                    "baseRefName": "master",
                                    "reviewThreads": {"nodes": []},
                                }
                            ]
                        }
                    }
                }
            },
            owner="pahtolo",
            repo="modular_quiz",
        )
        self.assertTrue(status["has_open_pr"])
        self.assertEqual(status["pull_request"]["number"], 15)


if __name__ == "__main__":
    unittest.main()
