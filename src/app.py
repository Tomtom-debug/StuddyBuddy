import json
import os
import pickle
import re
import sys
import numpy as np
from dotenv import load_dotenv
from flask import Flask
from sklearn.decomposition import PCA

load_dotenv()

# src/ directory and project root (one level up)
current_directory = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.dirname(current_directory)

if project_root not in sys.path:
    sys.path.insert(0, project_root)

from flask_cors import CORS
from models import db, Episode, Review
from routes import register_routes


# Processed directory for retrieval artifacts.
processed_directory = os.path.join(project_root, "processed")

# Serve React build files from <project_root>/frontend/dist
app = Flask(__name__,
    static_folder=os.path.join(project_root, 'frontend', 'dist'),
    static_url_path='')
CORS(app)

# Configure SQLite database - using 3 slashes for relative path
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///data.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize database with app
db.init_app(app)

# Register routes
register_routes(app)

# Function to initialize database, change this to your own database initialization logic
def init_db():
    with app.app_context():
        # Create all tables
        db.create_all()
        
        # Initialize database with data from init.json if empty
        if Episode.query.count() == 0:
            json_file_path = os.path.join(current_directory, 'init.json')
            with open(json_file_path, 'r') as file:
                data = json.load(file)
                for episode_data in data['episodes']:
                    episode = Episode(
                        id=episode_data['id'],
                        title=episode_data['title'],
                        descr=episode_data['descr']
                    )
                    db.session.add(episode)
                
                for review_data in data['reviews']:
                    review = Review(
                        id=review_data['id'],
                        imdb_rating=review_data['imdb_rating']
                    )
                    db.session.add(review)
            
            db.session.commit()
            print("Database initialized with episodes and reviews data")

def compute_dim_labels(vectorizer, words_compressed, top_n=8):
    vocab = vectorizer.get_feature_names_out()
    labels = []
    for dim in range(words_compressed.shape[1]):
        top_indices = np.argsort(np.abs(words_compressed[:, dim]))[-top_n:][::-1]
        labels.append(" · ".join(vocab[i] for i in top_indices))
    return labels


def load_bert_model():
    """Loads the shared BERT model once at startup. Skipped gracefully if not installed."""
    try:
        from sentence_transformers import SentenceTransformer
        print("Loading BERT model (all-MiniLM-L6-v2)…")
        app.config["BERT_MODEL"] = SentenceTransformer("all-MiniLM-L6-v2")
        print("BERT model loaded.")
    except ImportError:
        print("sentence-transformers not installed — BERT retrieval unavailable.")


def load_math_artifacts():
    try:
        with open(os.path.join(processed_directory, "math_problems.json"), "r", encoding="utf-8") as file:
            app.config["MATH_RECORDS"] = json.load(file)

        with open(os.path.join(processed_directory, "math_vectorizer.pkl"), "rb") as file:
            app.config["MATH_VECTORIZER"] = pickle.load(file)

        with open(os.path.join(processed_directory, "math_docs_compressed.pkl"), "rb") as file:
            app.config["MATH_DOCS_COMPRESSED"] = pickle.load(file)

        with open(os.path.join(processed_directory, "math_words_compressed.pkl"), "rb") as file:
            app.config["MATH_WORDS_COMPRESSED"] = pickle.load(file)

        with open(os.path.join(processed_directory, "math_tfidf_matrix.pkl"), "rb") as file:
            app.config["MATH_TFIDF_MATRIX"] = pickle.load(file)

        app.config["MATH_DIM_LABELS"] = compute_dim_labels(
            app.config["MATH_VECTORIZER"], app.config["MATH_WORDS_COMPRESSED"]
        )
    except FileNotFoundError:
        print("Math retrieval artifacts not found. Run preprocessing, TF-IDF indexing, and SVD indexing first.")

    bert_path = os.path.join(processed_directory, "math_bert_embeddings.npy")
    if os.path.exists(bert_path):
        app.config["MATH_BERT_EMBEDDINGS"] = np.load(bert_path)
        print(f"Math BERT embeddings loaded: shape={app.config['MATH_BERT_EMBEDDINGS'].shape}")
    else:
        print("Math BERT embeddings not found. Run: python -m lib.retrieval.bert_index")


def load_leetcode_artifacts():
    try:
        with open(os.path.join(processed_directory, "leetcode_problems.json"), "r", encoding="utf-8") as file:
            app.config["LEETCODE_RECORDS"] = json.load(file)

        with open(os.path.join(processed_directory, "leetcode_vectorizer.pkl"), "rb") as file:
            app.config["LEETCODE_VECTORIZER"] = pickle.load(file)

        with open(os.path.join(processed_directory, "leetcode_docs_compressed.pkl"), "rb") as file:
            app.config["LEETCODE_DOCS_COMPRESSED"] = pickle.load(file)

        with open(os.path.join(processed_directory, "leetcode_words_compressed.pkl"), "rb") as file:
            app.config["LEETCODE_WORDS_COMPRESSED"] = pickle.load(file)

        with open(os.path.join(processed_directory, "leetcode_tfidf_matrix.pkl"), "rb") as file:
            app.config["LEETCODE_TFIDF_MATRIX"] = pickle.load(file)

        app.config["LEETCODE_DIM_LABELS"] = compute_dim_labels(
            app.config["LEETCODE_VECTORIZER"], app.config["LEETCODE_WORDS_COMPRESSED"]
        )
    except FileNotFoundError:
        print("LeetCode retrieval artifacts not found. Run preprocessing, TF-IDF indexing, and SVD indexing first.")

    bert_path = os.path.join(processed_directory, "leetcode_bert_embeddings.npy")
    if os.path.exists(bert_path):
        app.config["LEETCODE_BERT_EMBEDDINGS"] = np.load(bert_path)
        print(f"LeetCode BERT embeddings loaded: shape={app.config['LEETCODE_BERT_EMBEDDINGS'].shape}")
    else:
        print("LeetCode BERT embeddings not found. Run: python -m lib.retrieval.leetcode_bert_index")


#init_db()
load_bert_model()
load_math_artifacts()
load_leetcode_artifacts()


# ── 3-D Universe helpers ──────────────────────────────────────────────────────

def _compute_3d_positions(matrix, scale=150.0):
    pca = PCA(n_components=3, random_state=42)
    pos = pca.fit_transform(matrix).astype(np.float32)
    for i in range(3):
        std = pos[:, i].std()
        pos[:, i] = np.clip(pos[:, i], -3 * std, 3 * std)
        ax_max = np.abs(pos[:, i]).max()
        if ax_max > 0:
            pos[:, i] = pos[:, i] / ax_max * scale
    return pos


def _compute_knn_edges(matrix, ids, k=4, min_sim=0.55):
    """Return deduplicated k-nearest-neighbor edges as {source, target, weight} dicts."""
    n = min(len(ids), matrix.shape[0])
    if n < 2:
        return []
    k_actual = min(k, n - 1)
    norms = np.linalg.norm(matrix[:n], axis=1, keepdims=True)
    norms[norms == 0] = 1
    normed = (matrix[:n] / norms).astype(np.float32)

    edges = []
    seen = set()
    chunk = 300
    for start in range(0, n, chunk):
        end = min(start + chunk, n)
        sim_chunk = normed[start:end] @ normed.T   # (chunk_size, n)
        for ci, i in enumerate(range(start, end)):
            row = sim_chunk[ci]
            row[i] = -1.0                          # exclude self
            top_idx = np.argpartition(row, -k_actual)[-k_actual:]
            for j in top_idx.tolist():
                if row[j] < min_sim:
                    continue
                a, b = min(i, j), max(i, j)
                if (a, b) not in seen:
                    seen.add((a, b))
                    edges.append({"source": ids[a], "target": ids[b], "weight": float(row[j])})
    return edges


def _classify_math_topic(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ['triangle', 'circle', 'angle', 'polygon', 'area', 'perimeter',
                             'radius', 'tangent', 'inscribed', 'chord', 'arc', 'perpendicular',
                             'parallelogram', 'rectangle', 'hexagon', 'diagonal']):
        return 'geometry'
    if any(w in t for w in ['prime', 'divisor', 'factor', 'gcd', 'lcm', 'modulo',
                             'remainder', 'congruent', 'digit', 'divisible', 'coprime']):
        return 'number_theory'
    if any(w in t for w in ['polynomial', 'quadratic', 'cubic', 'equation', 'coefficient',
                             'variable', 'inequality', 'logarithm', 'function', 'solve']):
        return 'algebra'
    if any(w in t for w in ['permutation', 'combination', 'probability', 'arrangement',
                             'ways', 'choose', 'subset', 'committee', 'distinct', 'counting']):
        return 'combinatorics'
    if any(w in t for w in ['sum', 'series', 'sequence', 'arithmetic', 'geometric',
                             'progression', 'converge', 'nth term', 'recursion']):
        return 'series'
    return 'other'


def _classify_cs_topic(record: dict) -> str:
    topics = ' '.join(t.lower() for t in (record.get('related_topics') or []))
    if any(w in topics for w in ['array', 'hash table', 'sliding window', 'two pointer']):
        return 'array'
    if any(w in topics for w in ['tree', 'graph', 'bfs', 'dfs', 'topological',
                                  'shortest path', 'union find']):
        return 'graph'
    if any(w in topics for w in ['dynamic programming', 'memoization',
                                  'backtracking', 'greedy']):
        return 'dp'
    if any(w in topics for w in ['string', 'trie', 'palindrome']):
        return 'string'
    if any(w in topics for w in ['math', 'bit manipulation', 'number theory']):
        return 'math'
    if any(w in topics for w in ['binary search', 'sorting', 'heap', 'priority queue']):
        return 'search'
    if any(w in topics for w in ['linked list', 'stack', 'queue', 'deque', 'monotonic']):
        return 'struct'
    return 'other'


def _single_line(text: str) -> str:
    return (text or "").replace('\n', ' ').strip()


def _plain_preview(text: str, limit: int = 120) -> str:
    cleaned = _single_line(text)
    cleaned = re.sub(r'\\text\{([^}]*)\}', r'\1', cleaned)
    cleaned = re.sub(r'\\(?:begin|end)\{[^}]+\}', ' ', cleaned)
    cleaned = re.sub(r'\\\[|\\\]|\\\(|\\\)|\$\$|\$', ' ', cleaned)
    cleaned = cleaned.replace('\\\\', ' ')
    cleaned = cleaned.replace('&', ' ').replace('{', ' ').replace('}', ' ')
    cleaned = cleaned.replace('_', ' ').replace('^', ' ')
    cleaned = re.sub(r'\\[a-zA-Z]+', ' ', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned[:limit].rstrip()


def precompute_universe():
    nodes = []

    math_docs    = app.config.get("MATH_DOCS_COMPRESSED")
    math_records = app.config.get("MATH_RECORDS") or []
    if math_docs is not None and math_records:
        pos = _compute_3d_positions(math_docs)
        pos[:, 0] -= 200          # shift left galaxy arm
        for i, rec in enumerate(math_records):
            p = pos[i]
            nodes.append({
                "id":         f"math_{rec['problem_id']}",
                "type":       "math",
                "problem_id": rec["problem_id"],
                "x": float(p[0]), "y": float(p[1]), "z": float(p[2]),
                "topic":   _classify_math_topic(rec.get("combined_text", "")),
                "preview": _single_line((rec.get("problem_raw", "") or "")[:120]),
                "preview_text": _plain_preview(rec.get("problem_raw", "") or "", limit=140),
                "full_text": _single_line(rec.get("problem_raw", "") or ""),
                "query_seed": _single_line((rec.get("problem_raw", "") or "")[:420]),
            })

    lc_docs    = app.config.get("LEETCODE_DOCS_COMPRESSED")
    lc_records = app.config.get("LEETCODE_RECORDS") or []
    if lc_docs is not None and lc_records:
        pos = _compute_3d_positions(lc_docs)
        pos[:, 0] += 200          # shift right galaxy arm
        for i, rec in enumerate(lc_records):
            p = pos[i]
            nodes.append({
                "id":         f"cs_{rec['problem_id']}",
                "type":       "cs",
                "problem_id": rec["problem_id"],
                "title":      rec.get("title", f"Problem #{rec['problem_id']}"),
                "x": float(p[0]), "y": float(p[1]), "z": float(p[2]),
                "topic":      _classify_cs_topic(rec),
                "difficulty": rec.get("difficulty", "Medium"),
                "url":        rec.get("url", ""),
                "preview":    _single_line((rec.get("description", "") or "")[:120]),
                "preview_text": _plain_preview(rec.get("description", "") or "", limit=140),
                "full_text": _single_line(rec.get("description", "") or ""),
                "query_seed": _single_line((
                    f"{rec.get('title', '')}. {rec.get('description', '')}" if rec.get("title") else rec.get("description", "")
                )[:420]),
            })

    app.config["UNIVERSE_NODES"] = nodes

    edges = []
    if math_docs is not None and math_records:
        math_ids = [f"math_{rec['problem_id']}" for rec in math_records]
        math_emb = app.config.get("MATH_BERT_EMBEDDINGS")
        edges += _compute_knn_edges(math_emb if math_emb is not None else math_docs, math_ids, k=4, min_sim=0.60)
    if lc_docs is not None and lc_records:
        cs_ids = [f"cs_{rec['problem_id']}" for rec in lc_records]
        cs_emb = app.config.get("LEETCODE_BERT_EMBEDDINGS")
        edges += _compute_knn_edges(cs_emb if cs_emb is not None else lc_docs, cs_ids, k=4, min_sim=0.60)
    app.config["UNIVERSE_EDGES"] = edges

    print(f"Universe precomputed: {len(nodes)} nodes "
          f"({len(math_records)} math + {len(lc_records)} cs), {len(edges)} edges")


precompute_universe()


if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=5001)
