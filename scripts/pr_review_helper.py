#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_REVIEW_TRIGGER_MESSAGE = "@codex review"


def _empty_pr_status() -> dict[str, Any]:
    return {
        "has_open_pr": False,
        "pull_request": None,
        "unresolved_threads": [],
        "unresolved_count": 0,
    }


def _run(args: list[str], *, cwd: Path | None = None) -> str:
    completed = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def _git_output(*args: str, cwd: Path | None = None) -> str:
    return _run(["git", *args], cwd=cwd)


def _gh_output(*args: str, cwd: Path | None = None) -> str:
    return _run(["gh", *args], cwd=cwd)


def parse_remote_slug(remote_url: str) -> str:
    normalized = remote_url.strip()
    if normalized.endswith(".git"):
        normalized = normalized[:-4]
    if normalized.startswith("git@github.com:"):
        return normalized.split("git@github.com:", 1)[1]
    if normalized.startswith("https://github.com/"):
        return normalized.split("https://github.com/", 1)[1]
    if normalized.startswith("ssh://git@github.com/"):
        return normalized.split("ssh://git@github.com/", 1)[1]
    raise ValueError(f"Unsupported GitHub remote URL: {remote_url}")


def repo_slug(cwd: Path | None = None) -> str:
    return parse_remote_slug(_git_output("remote", "get-url", "origin", cwd=cwd))


def github_remote_slugs(cwd: Path | None = None) -> dict[str, str]:
    remote_names = [name.strip() for name in _git_output("remote", cwd=cwd).splitlines() if name.strip()]
    slugs: dict[str, str] = {}
    for remote_name in remote_names:
        try:
            slugs[remote_name] = parse_remote_slug(_git_output("remote", "get-url", remote_name, cwd=cwd))
        except (subprocess.CalledProcessError, ValueError):
            continue
    return slugs


def current_branch(cwd: Path | None = None) -> str:
    return _git_output("rev-parse", "--abbrev-ref", "HEAD", cwd=cwd)


def configured_remote_for_branch(branch_name: str, cwd: Path | None = None) -> str | None:
    try:
        remote_name = _git_output("config", "--get", f"branch.{branch_name}.remote", cwd=cwd)
    except subprocess.CalledProcessError:
        return None
    return remote_name.strip() or None


def ordered_search_repo_slugs(remote_slugs: dict[str, str], *, preferred_remote: str | None = None) -> list[str]:
    ordered_slugs: list[str] = []

    def add_remote(remote_name: str | None) -> None:
        if not remote_name:
            return
        slug = remote_slugs.get(remote_name)
        if slug and slug not in ordered_slugs:
            ordered_slugs.append(slug)

    add_remote(preferred_remote)
    add_remote("upstream")
    add_remote("origin")
    for remote_name, slug in remote_slugs.items():
        if slug not in ordered_slugs:
            ordered_slugs.append(slug)
    return ordered_slugs


def build_pr_status_from_payloads(
    payloads_by_repo_slug: dict[str, dict[str, Any]],
    *,
    head_repo_slug: str,
    search_repo_slugs: list[str],
) -> dict[str, Any]:
    owner, repo = head_repo_slug.split("/", 1)
    for search_repo_slug in search_repo_slugs:
        payload = payloads_by_repo_slug.get(search_repo_slug)
        if payload is None:
            continue
        status = build_pr_status(payload, owner=owner, repo=repo)
        if status["has_open_pr"]:
            status["pull_request"]["repository_slug"] = search_repo_slug
            return status
    return _empty_pr_status()


def _graphql(owner: str, repo: str, head_ref_name: str, *, cwd: Path | None = None) -> dict[str, Any]:
    query = """
query($owner: String!, $repo: String!, $headRefName: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(first: 10, states: OPEN, headRefName: $headRefName, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        isDraft
        reviewDecision
        headRefName
        headRepository {
          name
        }
        headRepositoryOwner {
          login
        }
        baseRefName
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            path
            line
            originalLine
            comments(first: 20) {
              nodes {
                author {
                  login
                }
                body
                createdAt
                url
              }
            }
          }
        }
      }
    }
  }
}
""".strip()
    output = _gh_output(
        "api",
        "graphql",
        "-f",
        f"query={query}",
        "-F",
        f"owner={owner}",
        "-F",
        f"repo={repo}",
        "-F",
        f"headRefName={head_ref_name}",
        cwd=cwd,
    )
    return json.loads(output)


def _latest_comment(thread: dict[str, Any]) -> dict[str, Any] | None:
    comments = (((thread.get("comments") or {}).get("nodes")) or [])
    if not comments:
        return None
    return comments[-1]


def _normalized_repo_value(value: Any) -> str:
    return str(value or "").strip().lower()


def _matching_pr_nodes(payload: dict[str, Any], *, owner: str, repo: str) -> list[dict[str, Any]]:
    nodes = ((((payload.get("data") or {}).get("repository") or {}).get("pullRequests") or {}).get("nodes")) or []
    matches: list[dict[str, Any]] = []
    expected_owner = _normalized_repo_value(owner)
    expected_repo = _normalized_repo_value(repo)
    for node in nodes:
        head_repo_name = _normalized_repo_value((node.get("headRepository") or {}).get("name"))
        head_repo_owner = _normalized_repo_value((node.get("headRepositoryOwner") or {}).get("login"))
        if head_repo_name != expected_repo or head_repo_owner != expected_owner:
            continue
        matches.append(node)
    return matches


def build_pr_status(payload: dict[str, Any], *, owner: str, repo: str) -> dict[str, Any]:
    nodes = _matching_pr_nodes(payload, owner=owner, repo=repo)
    if not nodes:
        return _empty_pr_status()

    pr = nodes[0]
    unresolved_threads: list[dict[str, Any]] = []
    for thread in (((pr.get("reviewThreads") or {}).get("nodes")) or []):
        if thread.get("isResolved") or thread.get("isOutdated"):
            continue
        latest_comment = _latest_comment(thread)
        unresolved_threads.append(
            {
                "path": thread.get("path"),
                "line": thread.get("line") or thread.get("originalLine"),
                "author": ((latest_comment or {}).get("author") or {}).get("login"),
                "body": (latest_comment or {}).get("body", "").strip(),
                "url": (latest_comment or {}).get("url"),
                "created_at": (latest_comment or {}).get("createdAt"),
                "comment_count": len((((thread.get("comments") or {}).get("nodes")) or [])),
            }
        )

    return {
        "has_open_pr": True,
        "pull_request": {
            "number": pr.get("number"),
            "title": pr.get("title"),
            "url": pr.get("url"),
            "is_draft": bool(pr.get("isDraft")),
            "review_decision": pr.get("reviewDecision"),
            "head_ref_name": pr.get("headRefName"),
            "base_ref_name": pr.get("baseRefName"),
        },
        "unresolved_threads": unresolved_threads,
        "unresolved_count": len(unresolved_threads),
    }


def fetch_pr_status(cwd: Path | None = None, *, branch: str | None = None) -> dict[str, Any]:
    branch_name = branch or current_branch(cwd)
    remote_slugs = github_remote_slugs(cwd)
    preferred_remote = configured_remote_for_branch(branch_name, cwd=cwd) or "origin"
    head_repo_slug = remote_slugs.get(preferred_remote) or remote_slugs.get("origin")
    if not head_repo_slug:
        raise SystemExit("No GitHub remote found for the current branch.")

    payloads_by_repo_slug: dict[str, dict[str, Any]] = {}
    search_repo_slugs = ordered_search_repo_slugs(remote_slugs, preferred_remote=preferred_remote)
    for search_repo_slug in search_repo_slugs:
        owner, repo = search_repo_slug.split("/", 1)
        payloads_by_repo_slug[search_repo_slug] = _graphql(owner, repo, branch_name, cwd=cwd)
    return build_pr_status_from_payloads(
        payloads_by_repo_slug,
        head_repo_slug=head_repo_slug,
        search_repo_slugs=search_repo_slugs,
    )


def post_pr_comment(
    cwd: Path | None = None,
    *,
    branch: str | None = None,
    message: str,
) -> dict[str, Any]:
    status = fetch_pr_status(cwd, branch=branch)
    if not status["has_open_pr"]:
        raise SystemExit("No open pull request found for the current branch.")
    pr = status["pull_request"]
    pr_number = pr["number"]
    comment_args = ["pr", "comment", str(pr_number)]
    if pr.get("repository_slug"):
        comment_args.extend(["--repo", pr["repository_slug"]])
    comment_args.extend(["--body", message])
    _gh_output(*comment_args, cwd=cwd)
    return status


def _print_text_status(status: dict[str, Any]) -> None:
    if not status["has_open_pr"]:
        print("No open pull request found for the current branch.")
        return
    pr = status["pull_request"]
    print(f"PR #{pr['number']}: {pr['title']}")
    print(pr["url"])
    print(f"Review decision: {pr['review_decision'] or 'none'}")
    print(f"Unresolved threads: {status['unresolved_count']}")
    for index, thread in enumerate(status["unresolved_threads"], start=1):
        location = thread["path"] or "<unknown file>"
        if thread["line"]:
            location = f"{location}:{thread['line']}"
        print(f"{index}. {location} [{thread['author'] or 'unknown'}]")
        if thread["body"]:
            print(f"   {thread['body']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect or advance the PR review loop for the current branch.")
    parser.add_argument("--cwd", default=".", help="Repository root to inspect.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    status_parser = subparsers.add_parser("status", help="Print the current branch PR status and unresolved review threads.")
    status_parser.add_argument("--branch", help="Override the branch name instead of using the current branch.")
    status_parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")

    comment_parser = subparsers.add_parser("comment", help="Post a PR comment on the current branch PR.")
    comment_parser.add_argument("--branch", help="Override the branch name instead of using the current branch.")
    comment_parser.add_argument("--message", required=True, help="Comment body to post to the PR.")
    comment_parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON after posting.")

    trigger_parser = subparsers.add_parser("trigger-review", help="Manually trigger a Codex review on the current branch PR.")
    trigger_parser.add_argument("--branch", help="Override the branch name instead of using the current branch.")
    trigger_parser.add_argument(
        "--message",
        default=DEFAULT_REVIEW_TRIGGER_MESSAGE,
        help="Comment body to post to the PR to trigger review.",
    )
    trigger_parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON after posting.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    cwd = Path(args.cwd).resolve()

    if args.command == "status":
        status = fetch_pr_status(cwd, branch=args.branch)
        if args.json:
            print(json.dumps(status, indent=2))
        else:
            _print_text_status(status)
        return 0

    if args.command in {"comment", "trigger-review"}:
        status = post_pr_comment(cwd, branch=args.branch, message=args.message)
        if args.json:
            print(json.dumps(status, indent=2))
        else:
            pr = status["pull_request"]
            print(f"Posted PR comment on PR #{pr['number']}: {pr['url']}")
        return 0

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
