"""Builds and saves an SVD index for StudyBuddy math problems.

Runs *after* tfidf_index.py — reads the saved TF-IDF matrix and decomposes it.
Produces two artifacts:
  - math_docs_compressed.pkl   : document vectors in SVD space (num_docs × k)
  - math_words_compressed.pkl  : word vectors in SVD space (vocab_size × k)
                                  used to fold new queries into the SVD space
"""

from __future__ import annotations

import pickle
from pathlib import Path
from typing import Any

import numpy as np
from scipy.sparse.linalg import svds
from sklearn.preprocessing import normalize

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATRIX_PATH = PROJECT_ROOT / "processed" / "math_tfidf_matrix.pkl"
DEFAULT_DOCS_PATH = PROJECT_ROOT / "processed" / "math_docs_compressed.pkl"
DEFAULT_WORDS_PATH = PROJECT_ROOT / "processed" / "math_words_compressed.pkl"

# Number of latent dimensions to keep.
# Math dataset has ~470 docs — 100 captures the vast majority of variance.
SVD_K = 100


def build_svd(matrix: Any, k: int = SVD_K) -> tuple[np.ndarray, np.ndarray]:
    """Decomposes a TF-IDF matrix via truncated SVD.

    Returns:
        docs_compressed  : row-normalised document matrix (num_docs × k)
        words_compressed : word matrix for query folding  (vocab_size × k)
    """
    # svds returns singular values in *ascending* order — reverse to descending
    u, s, vt = svds(matrix, k=k)
    u = u[:, ::-1]
    s = s[::-1]
    vt = vt[::-1, :]

    # Scale docs by singular values so dimensions are properly weighted
    docs_compressed = normalize(u * s)       # (num_docs, k)
    words_compressed = vt.T                  # (vocab_size, k)

    return docs_compressed, words_compressed


def save_svd_artifacts(
    docs_compressed: np.ndarray,
    words_compressed: np.ndarray,
    docs_path: Path = DEFAULT_DOCS_PATH,
    words_path: Path = DEFAULT_WORDS_PATH,
) -> None:
    docs_path.parent.mkdir(parents=True, exist_ok=True)

    with docs_path.open("wb") as f:
        pickle.dump(docs_compressed, f)

    with words_path.open("wb") as f:
        pickle.dump(words_compressed, f)


def main() -> None:
    """CLI entrypoint for building the math SVD index."""
    with DEFAULT_MATRIX_PATH.open("rb") as f:
        matrix = pickle.load(f)

    num_docs, vocab_size = matrix.shape
    k = min(SVD_K, num_docs - 1, vocab_size - 1)

    print(f"Matrix shape: {num_docs} docs × {vocab_size} vocab — using k={k}")
    docs_compressed, words_compressed = build_svd(matrix, k=k)
    save_svd_artifacts(docs_compressed, words_compressed)

    print(
        f"Saved math SVD artifacts: "
        f"docs={docs_compressed.shape}, words={words_compressed.shape}"
    )


if __name__ == "__main__":
    main()
