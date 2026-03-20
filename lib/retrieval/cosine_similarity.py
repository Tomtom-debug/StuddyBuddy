"""Cosine similarity ranking helpers for StudyBuddy retrieval."""

from __future__ import annotations

from typing import Any

from sklearn.metrics.pairwise import cosine_similarity


def rank_by_cosine(
    query_vector: Any,
    document_matrix: Any,
    top_k: int = 5,
) -> list[tuple[int, float]]:
    """Returns the top-k document indexes ranked by cosine similarity."""
    similarity_scores = cosine_similarity(query_vector, document_matrix).flatten()
    ranked_indexes = similarity_scores.argsort()[::-1][:top_k]

    return [
        (int(document_index), float(similarity_scores[document_index]))
        for document_index in ranked_indexes
    ]
