from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class SourceFile:
    path: Path
    source_kind: str = "file"  # file | folder_scan


@dataclass
class ExtractedMaterial:
    path: Path
    content: str = ""
    extracted_by: str = ""
    needs_ocr: bool = False
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class GenerationRequest:
    quiz_dir: Path
    sources: list[SourceFile]
    provider: str
    model: str
    total: int
    mcq_count: int
    short_count: int
    mcq_options: int = 4
    title_hint: str = ""
    instructions_hint: str = ""
    output_subdir: str = "Generated"
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class GenerationResult:
    total: int = 0
    mcq_count: int = 0
    short_count: int = 0
    mcq_options: int = 4
    output_path: Path | None = None
    quiz_json_text: str = ""
    extracted_materials: list[ExtractedMaterial] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.output_path is not None and not self.errors
