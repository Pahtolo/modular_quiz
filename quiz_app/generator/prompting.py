from dataclasses import dataclass

GENERATION_SOURCE_CHAR_LIMIT = 120000


@dataclass(frozen=True)
class QuizGenerationPrompt:
    system: str
    user: str


def build_quiz_generation_prompt(
    *,
    materials_text: str,
    title_hint: str,
    instructions_hint: str,
    total_questions: int,
    mcq_count: int,
    short_count: int,
    mcq_options: int,
    source_char_limit: int = GENERATION_SOURCE_CHAR_LIMIT,
) -> QuizGenerationPrompt:
    system = (
        "You generate quiz JSON only. No markdown, no prose. "
        "Return one JSON object with keys title, instructions, questions. "
        "Question types allowed: mcq and short only."
    )
    user = (
        f"Create a quiz with exactly {total_questions} questions: "
        f"{mcq_count} mcq and {short_count} short.\n"
        f"MCQ option count should be {mcq_options}.\n"
        f"Title hint: {title_hint or 'Generated Quiz'}\n"
        f"Instructions hint: {instructions_hint or 'Answer all questions.'}\n"
        "Schema:\n"
        "- title: string\n"
        "- instructions: string\n"
        "- questions: array\n"
        "mcq question: id,type,prompt,options,answer,points\n"
        "short question: id,type,prompt,expected,points\n\n"
        "Return valid JSON only.\n\n"
        f"Source material:\n{materials_text[:source_char_limit]}"
    )
    return QuizGenerationPrompt(system=system, user=user)
