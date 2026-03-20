"""Retrieval and indexing helpers for StudyBuddy."""

from .tfidf_index import build_vectorizer, fit_math_index, load_processed_math_records

__all__ = ["build_vectorizer", "fit_math_index", "load_processed_math_records"]

