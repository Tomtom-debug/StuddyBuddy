"""End-to-end LeetCode retrieval using preprocessing, TF-IDF, and cosine similarity."""

from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import Any

try:
    from lib.preprocess import build_combined_text
    from .cosine_similarity import rank_by_cosine
    from .leetcode_tfidf_index import (
        DEFAULT_INPUT_PATH,
        DEFAULT_MATRIX_PATH,
        DEFAULT_VECTORIZER_PATH,
        build_vectorizer,
        fit_leetcode_index,
        load_processed_leetcode_records,
    )
except ImportError:  # pragma: no cover - direct script execution fallback
    import sys

    CURRENT_DIR = Path(__file__).resolve().parent
    PROJECT_ROOT = CURRENT_DIR.parents[1]
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    from lib.preprocess import build_combined_text
    from lib.retrieval.cosine_similarity import rank_by_cosine
    from lib.retrieval.leetcode_tfidf_index import (
        DEFAULT_INPUT_PATH,
        DEFAULT_MATRIX_PATH,
        DEFAULT_VECTORIZER_PATH,
        build_vectorizer,
        fit_leetcode_index,
        load_processed_leetcode_records,
    )


def load_saved_index(
    vectorizer_path: Path = DEFAULT_VECTORIZER_PATH,
    matrix_path: Path = DEFAULT_MATRIX_PATH,
) -> tuple[Any, Any]:
    """Loads saved vectorizer and matrix artifacts."""
    with vectorizer_path.open("rb") as vectorizer_file:
        vectorizer = pickle.load(vectorizer_file)

    with matrix_path.open("rb") as matrix_file:
        matrix = pickle.load(matrix_file)

    return vectorizer, matrix


def load_or_build_index() -> tuple[list[dict[str, Any]], Any, Any]:
    """Loads the processed records and an available TF-IDF index."""
    records = load_processed_leetcode_records(DEFAULT_INPUT_PATH)

    if DEFAULT_VECTORIZER_PATH.exists() and DEFAULT_MATRIX_PATH.exists():
        vectorizer, matrix = load_saved_index()
        return records, vectorizer, matrix

    vectorizer = build_vectorizer()
    vectorizer, matrix, _ = fit_leetcode_index(records, vectorizer)
    return records, vectorizer, matrix


def search_leetcode_problems(query: str, top_k: int = 5) -> dict[str, Any]:
    """Searches the LeetCode dataset and returns ranked results."""
    records, vectorizer, matrix = load_or_build_index()
    query_text = build_combined_text(query)
    query_vector = vectorizer.transform([query_text])
    ranked_matches = rank_by_cosine(query_vector, matrix, top_k=top_k)

    results = []
    for document_index, score in ranked_matches:
        record = records[document_index]
        results.append(
            {
                "problem_id": record["problem_id"],
                "title": record["title"],
                "description": record["description"],
                "difficulty": record["difficulty"],
                "acceptance_rate": record["acceptance_rate"],
                "url": record["url"],
                "solution_link": record["solution_link"],
                "companies": record["companies"],
                "related_topics": record["related_topics"],
                "similar_questions": record["similar_questions"],
                "similarity_score": score,
            }
        )

    return {
        "query": query,
        "query_combined_text": query_text,
        "results": results,
    }


def main() -> None:
    """Simple CLI demo for the LeetCode retrieval pipeline."""
    example_query = "two pointers sliding window array"
    response = search_leetcode_problems(example_query, top_k=3)
    print(json.dumps(response, indent=2))


if __name__ == "__main__":
    main()
