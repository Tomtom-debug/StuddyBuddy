"""Preprocesses the math dataset into JSON records for retrieval."""

from __future__ import annotations

import csv
import json
from pathlib import Path

try:
    from .text_cleaning import preprocess_text
except ImportError:  # pragma: no cover - direct script execution fallback
    from text_cleaning import preprocess_text


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT_PATH = PROJECT_ROOT / "data" / "math_problems.csv"
DEFAULT_OUTPUT_PATH = PROJECT_ROOT / "processed" / "math_problems.json"


def build_math_records(input_path: Path = DEFAULT_INPUT_PATH) -> list[dict[str, object]]:
    """Loads the math CSV and returns processed retrieval records."""
    records: list[dict[str, object]] = []

    with input_path.open(newline="", encoding="utf-8") as csv_file:
        reader = csv.DictReader(csv_file)
        for problem_id, row in enumerate(reader):
            problem_raw = row["problem"].strip()
            answer = row["answer"].strip()
            processed = preprocess_text(problem_raw)

            records.append(
                {
                    "problem_id": problem_id,
                    "problem_raw": problem_raw,
                    "answer": answer,
                    "normalized_text": processed["normalized_text"],
                    "tokens": processed["tokens"],
                    "latex_tokens": processed["latex_tokens"],
                    "combined_text": processed["combined_text"],
                }
            )

    return records


def write_math_records(
    records: list[dict[str, object]],
    output_path: Path = DEFAULT_OUTPUT_PATH,
) -> None:
    """Writes processed math records to JSON."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(records, indent=2), encoding="utf-8")


def main() -> None:
    """CLI entrypoint for preprocessing the math dataset."""
    records = build_math_records()
    write_math_records(records)
    print(f"Wrote {len(records)} math records to {DEFAULT_OUTPUT_PATH}")


if __name__ == "__main__":
    main()
