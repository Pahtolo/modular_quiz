import re

_VOICE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b[Tt]he user['’]s answer\b"), "your answer"),
    (re.compile(r"\b[Tt]he student['’]s answer\b"), "your answer"),
    (re.compile(r"\b[Tt]he user['’]s\b"), "your"),
    (re.compile(r"\b[Tt]he student['’]s\b"), "your"),
    (re.compile(r"\b[Tt]he user\b"), "you"),
    (re.compile(r"\b[Tt]he student\b"), "you"),
    (re.compile(r"\btheir answer\b"), "your answer"),
)


def to_second_person(text: str) -> str:
    output = text
    for pattern, replacement in _VOICE_PATTERNS:
        output = pattern.sub(replacement, output)
    return output
