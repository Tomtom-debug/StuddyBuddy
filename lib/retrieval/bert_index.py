"""Builds and saves BERT sentence embeddings for math problems.

Requires sentence-transformers (pip install sentence-transformers).
Run after math_preprocess.py:
    python -m lib.retrieval.bert_index

Produces:
    processed/math_bert_embeddings.npy  — (num_docs, 384) float32, L2-normalised
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RECORDS_PATH = PROJECT_ROOT / "processed" / "math_problems.json"
EMBEDDINGS_PATH = PROJECT_ROOT / "processed" / "math_bert_embeddings.npy"

MODEL_NAME = "all-MiniLM-L6-v2"


def build_embeddings(texts: list[str]) -> np.ndarray:
    from sentence_transformers import SentenceTransformer
    model = SentenceTransformer(MODEL_NAME)
    embeddings = model.encode(
        texts,
        batch_size=64,
        show_progress_bar=True,
        normalize_embeddings=True,
    )
    return embeddings.astype(np.float32)


def main() -> None:
    with RECORDS_PATH.open("r", encoding="utf-8") as f:
        records = json.load(f)

    texts = [r.get("combined_text") or r.get("problem_raw", "") for r in records]
    print(f"Encoding {len(texts)} math problems with {MODEL_NAME}…")

    embeddings = build_embeddings(texts)
    EMBEDDINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    np.save(EMBEDDINGS_PATH, embeddings)
    print(f"Saved: {EMBEDDINGS_PATH}  shape={embeddings.shape}")


if __name__ == "__main__":
    main()
