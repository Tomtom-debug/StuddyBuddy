"""Reusable text preprocessing for dataset records and user queries."""

from __future__ import annotations

import re
from typing import Iterable


LATEX_COMMAND_REPLACEMENTS = {
    r"\frac": " frac ",
    r"\sqrt": " sqrt ",
    r"\angle": " angle ",
    r"\triangle": " triangle ",
    r"\cdot": " times ",
    r"\times": " times ",
    r"\le": " leq ",
    r"\ge": " geq ",
    r"\equiv": " equivalent ",
    r"\pmod": " mod ",
    r"\log": " log ",
    r"\sin": " sin ",
    r"\cos": " cos ",
    r"\tan": " tan ",
    r"\overline": " segment ",
    r"\overrightarrow": " ray ",
    r"\overleftrightarrow": " line ",
    r"\lfloor": " floor ",
    r"\rfloor": " floor ",
    r"\lceil": " ceil ",
    r"\rceil": " ceil ",
    r"\dots": " sequence ",
    r"\ldots": " sequence ",
    r"\circ": " degree ",
}

LATEX_COMMAND_PATTERN = re.compile(r"\\([a-zA-Z]+)")

FILLER_WORDS = {
    "a",
    "an",
    "and",
    "be",
    "find",
    "for",
    "given",
    "if",
    "in",
    "is",
    "let",
    "of",
    "suppose",
    "that",
    "the",
    "then",
    "to",
    "with",
}

TOKEN_NORMALIZATION_MAP = {
    "angles": "angle",
    "circles": "circle",
    "coefficients": "coefficient",
    "circ": "degree",
    "cdot": "times",
    "diagonals": "diagonal",
    "equations": "equation",
    "graphs": "graph",
    "integers": "integer",
    "le": "leq",
    "lines": "line",
    "overleftrightarrow": "line",
    "overline": "segment",
    "overrightarrow": "ray",
    "pmod": "mod",
    "polynomials": "polynomial",
    "points": "point",
    "radii": "radius",
    "rfloor": "floor",
    "rceil": "ceil",
    "segments": "segment",
    "sides": "side",
    "spheres": "sphere",
    "sqrt": "sqrt",
    "tangency": "tangent",
    "triangles": "triangle",
    "vertices": "vertex",
    "frac": "frac",
    "ge": "geq",
    "ldots": "sequence",
    "lfloor": "floor",
    "lceil": "ceil",
    "triangle": "triangle",
    "dots": "sequence",
}


def normalize_latex(text: str) -> str:
    """Converts common LaTeX commands into retrieval-friendly tokens."""
    normalized = text

    for command, replacement in LATEX_COMMAND_REPLACEMENTS.items():
        normalized = normalized.replace(command, replacement)

    normalized = normalized.replace("$", " ")
    normalized = normalized.replace("^", " ")
    normalized = normalized.replace("_", " ")
    normalized = normalized.replace("{", " ")
    normalized = normalized.replace("}", " ")

    # Remove any remaining LaTeX command names we do not map explicitly.
    normalized = re.sub(r"\\[a-zA-Z]+", " ", normalized)
    return normalized


def extract_latex_commands(text: str) -> list[str]:
    """Extracts normalized LaTeX command names from raw text."""
    commands = []
    for command_name in LATEX_COMMAND_PATTERN.findall(text.lower()):
        commands.append(canonicalize_token(command_name))
    return commands


def normalize_text(text: str) -> str:
    """Lowercases and strips punctuation while keeping alphanumerics."""
    normalized = normalize_latex(text.lower())
    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def tokenize(text: str) -> list[str]:
    """Splits normalized text into simple retrieval tokens."""
    return [token for token in normalize_text(text).split() if token]


def canonicalize_token(token: str) -> str:
    """Maps common token variants to a shared retrieval form."""
    if token in TOKEN_NORMALIZATION_MAP:
        return TOKEN_NORMALIZATION_MAP[token]

    if len(token) > 4 and token.endswith("ies"):
        return token[:-3] + "y"

    if len(token) > 4 and token.endswith("es"):
        return token[:-2]

    if len(token) > 3 and token.endswith("s") and not token.endswith("ss"):
        return token[:-1]

    return token


def filter_tokens(tokens: Iterable[str]) -> list[str]:
    """Drops short and low-signal filler tokens."""
    filtered = []
    for token in tokens:
        token = canonicalize_token(token)
        if token in FILLER_WORDS:
            continue
        if len(token) == 1 and not token.isdigit():
            continue
        filtered.append(token)
    return filtered


def preprocess_text(text: str) -> dict[str, object]:
    """Returns reusable preprocessing artifacts for one text input."""
    normalized_text = normalize_text(text)
    raw_tokens = normalized_text.split()
    filtered_tokens = filter_tokens(raw_tokens)
    latex_tokens = filter_tokens(extract_latex_commands(text))
    combined_tokens = filtered_tokens + latex_tokens

    return {
        "normalized_text": normalized_text,
        "tokens": filtered_tokens,
        "latex_tokens": latex_tokens,
        "combined_text": " ".join(combined_tokens),
    }


def build_combined_text(text: str) -> str:
    """Builds the text field used later for TF-IDF vectorization."""
    processed = preprocess_text(text)
    return processed["combined_text"]
