"""Builds and saves a TF-IDF index for StudyBuddy math problems."""

from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import Any

from sklearn.feature_extraction.text import TfidfVectorizer


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT_PATH = PROJECT_ROOT / "processed" / "math_problems.json"
DEFAULT_VECTORIZER_PATH = PROJECT_ROOT / "processed" / "math_vectorizer.pkl"
DEFAULT_MATRIX_PATH = PROJECT_ROOT / "processed" / "math_tfidf_matrix.pkl"
DEFAULT_METADATA_PATH = PROJECT_ROOT / "processed" / "math_index_meta.json"


def build_vectorizer(
    max_features: int = 5000,
    stop_words: str | None = "english",
    max_df: float = 0.8,
    min_df: int = 2,
    norm: str = "l2",
) -> TfidfVectorizer:
    """Returns the reusable vectorizer configuration for math retrieval."""
    return TfidfVectorizer(
        max_features=max_features,
        stop_words=stop_words,
        max_df=max_df,
        min_df=min_df,
        norm=norm,
    )


def load_processed_math_records(
    input_path: Path = DEFAULT_INPUT_PATH,
) -> list[dict[str, Any]]:
    """Loads preprocessed math records from JSON."""
    with input_path.open(encoding="utf-8") as json_file:
        return json.load(json_file)


def fit_math_index(
    records: list[dict[str, Any]],
    vectorizer: TfidfVectorizer | None = None,
) -> tuple[TfidfVectorizer, Any, dict[str, Any]]:
    """Fits a TF-IDF vectorizer on the preprocessed math records."""
    vectorizer = vectorizer or build_vectorizer()
    documents = [record["combined_text"] for record in records]
    matrix = vectorizer.fit_transform(documents)

    metadata = {
        "dataset_name": "math",
        "num_docs": len(records),
        "doc_ids": [record["problem_id"] for record in records],
        "num_features": len(vectorizer.get_feature_names_out()),
        "vectorizer_config": {
            "max_features": vectorizer.max_features,
            "stop_words": vectorizer.stop_words,
            "max_df": vectorizer.max_df,
            "min_df": vectorizer.min_df,
            "norm": vectorizer.norm,
        },
    }

    return vectorizer, matrix, metadata


def save_math_index(
    vectorizer: TfidfVectorizer,
    matrix: Any,
    metadata: dict[str, Any],
    vectorizer_path: Path = DEFAULT_VECTORIZER_PATH,
    matrix_path: Path = DEFAULT_MATRIX_PATH,
    metadata_path: Path = DEFAULT_METADATA_PATH,
) -> None:
    """Saves the fitted vectorizer, sparse matrix, and metadata."""
    vectorizer_path.parent.mkdir(parents=True, exist_ok=True)

    with vectorizer_path.open("wb") as vectorizer_file:
        pickle.dump(vectorizer, vectorizer_file)

    with matrix_path.open("wb") as matrix_file:
        pickle.dump(matrix, matrix_file)

    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")


def main() -> None:
    """CLI entrypoint for fitting the math TF-IDF index."""
    records = load_processed_math_records()
    vectorizer, matrix, metadata = fit_math_index(records)
    save_math_index(vectorizer, matrix, metadata)
    print(
        "Saved TF-IDF index for "
        f"{metadata['num_docs']} math problems with {metadata['num_features']} features"
    )


if __name__ == "__main__":
    main()
