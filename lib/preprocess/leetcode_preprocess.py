"""Preprocesses the LeetCode dataset into JSON records for retrieval."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

try:
    from .text_cleaning import preprocess_text
except ImportError:  # pragma: no cover - direct script execution fallback
    from text_cleaning import preprocess_text


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT_PATH = PROJECT_ROOT / "data" / "leetcode_dataset.csv"
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "processed" / "leetcode_problems.json"

SIMILAR_QUESTION_TITLE_PATTERN = re.compile(r"\[(.*?),\s*/problems/")


def parse_float(value: str) -> float | None:
    """Parses a float field from CSV, returning None for empty values."""
    if not value:
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_int(value: str) -> int | None:
    """Parses an integer field from CSV, returning None for empty values."""
    if not value:
        return None

    cleaned = value.strip()
    if not cleaned:
        return None

    try:
        return int(cleaned)
    except ValueError:
        return None


def parse_bool(value: str) -> bool | None:
    """Parses a boolean-like CSV field into a Python bool."""
    if not value:
        return None

    cleaned = value.strip().lower()
    if cleaned in {"1", "true", "yes"}:
        return True
    if cleaned in {"0", "false", "no"}:
        return False
    return None


def split_list_field(value: str) -> list[str]:
    """Splits comma-delimited CSV fields into a clean list."""
    if not value:
        return []

    return [item.strip() for item in value.split(",") if item and item.strip()]


def parse_similar_question_titles(value: str) -> list[str]:
    """Extracts similar-question titles from the packed CSV field."""
    if not value:
        return []

    titles = []
    for match in SIMILAR_QUESTION_TITLE_PATTERN.finditer(value):
        title = match.group(1).strip()
        if title:
            titles.append(title)
    return titles


def build_retrieval_text(
    title: str,
    description: str,
    difficulty: str,
    related_topics: list[str],
    companies: list[str],
    similar_questions: list[str],
) -> str:
    """Builds a text blob used as the source for preprocessing."""
    chunks = [
        title,
        description,
        difficulty,
        " ".join(related_topics),
        " ".join(companies),
        " ".join(similar_questions),
    ]
    return " ".join(chunk for chunk in chunks if chunk)


def build_leetcode_records(
    input_path: Path = DEFAULT_INPUT_PATH,
) -> list[dict[str, object]]:
    """Loads the LeetCode CSV and returns processed retrieval records."""
    records: list[dict[str, object]] = []

    with input_path.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        for fallback_id, row in enumerate(reader):
            title = (row.get("title") or "").strip()
            description = (row.get("description") or "").strip()
            difficulty = (row.get("difficulty") or "").strip()
            companies = split_list_field(row.get("companies") or "")
            related_topics = split_list_field(row.get("related_topics") or "")
            similar_questions = parse_similar_question_titles(
                row.get("similar_questions") or ""
            )

            combined_source_text = build_retrieval_text(
                title=title,
                description=description,
                difficulty=difficulty,
                related_topics=related_topics,
                companies=companies,
                similar_questions=similar_questions,
            )
            processed = preprocess_text(combined_source_text)

            parsed_problem_id = parse_int(row.get("id") or "")
            problem_id = parsed_problem_id if parsed_problem_id is not None else fallback_id

            records.append(
                {
                    "problem_id": problem_id,
                    "title": title,
                    "description": description,
                    "difficulty": difficulty,
                    "url": (row.get("url") or "").strip(),
                    "solution_link": (row.get("solution_link") or "").strip(),
                    "is_premium": parse_bool(row.get("is_premium") or ""),
                    "asked_by_faang": parse_bool(row.get("asked_by_faang") or ""),
                    "acceptance_rate": parse_float(row.get("acceptance_rate") or ""),
                    "frequency": parse_float(row.get("frequency") or ""),
                    "likes": parse_int(row.get("likes") or ""),
                    "dislikes": parse_int(row.get("dislikes") or ""),
                    "rating": parse_float(row.get("rating") or ""),
                    "accepted": parse_int(row.get("accepted") or ""),
                    "submissions": parse_int(row.get("submissions") or ""),
                    "discuss_count": parse_int(row.get("discuss_count") or ""),
                    "companies": companies,
                    "related_topics": related_topics,
                    "similar_questions": similar_questions,
                    "normalized_text": processed["normalized_text"],
                    "tokens": processed["tokens"],
                    "latex_tokens": processed["latex_tokens"],
                    "combined_text": processed["combined_text"],
                }
            )

    return records


def write_leetcode_records(
    records: list[dict[str, object]],
    output_path: Path = DEFAULT_OUTPUT_PATH,
) -> None:
    """Writes processed LeetCode records to JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(records, indent=2), encoding="utf-8")


def main() -> None:
    """CLI entrypoint for preprocessing the LeetCode dataset."""
    records = build_leetcode_records()
    write_leetcode_records(records)
    print(f"Wrote {len(records)} LeetCode records to {DEFAULT_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
