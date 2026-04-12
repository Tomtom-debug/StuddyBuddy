"""
Routes: React app serving and StudyBuddy search API.

To enable AI chat, set USE_LLM = True below. See llm_routes.py for AI code.
"""
import os
from flask import send_from_directory, request, jsonify
from models import db, Episode, Review
from lib.preprocess import build_combined_text
from lib.retrieval.cosine_similarity import rank_by_cosine
from sklearn.preprocessing import normalize


# ── AI toggle ────────────────────────────────────────────────────────────────
USE_LLM = False
# USE_LLM = True
# ─────────────────────────────────────────────────────────────────────────────


def json_search(query):
    if not query or not query.strip():
        query = "study"
    results = db.session.query(Episode, Review).join(
        Review, Episode.id == Review.id
    ).filter(
        Episode.title.ilike(f'%{query}%')
    ).all()
    matches = []
    for episode, review in results:
        matches.append({
            'title': episode.title,
            'descr': episode.descr,
            'imdb_rating': review.imdb_rating
        })
    return matches


def get_retrieval_artifacts(app, subject):
    """Returns loaded retrieval artifacts for a supported subject."""
    if subject == "math":
        records_key = "MATH_RECORDS"
        vectorizer_key = "MATH_VECTORIZER"
        docs_key = "MATH_DOCS_COMPRESSED"
        words_key = "MATH_WORDS_COMPRESSED"
    elif subject == "leetcode":
        records_key = "LEETCODE_RECORDS"
        vectorizer_key = "LEETCODE_VECTORIZER"
        docs_key = "LEETCODE_DOCS_COMPRESSED"
        words_key = "LEETCODE_WORDS_COMPRESSED"
    else:
        raise ValueError("subject must be 'math' or 'cs'")

    records = app.config.get(records_key)
    vectorizer = app.config.get(vectorizer_key)
    docs_compressed = app.config.get(docs_key)
    words_compressed = app.config.get(words_key)

    if any(v is None for v in (records, vectorizer, docs_compressed, words_compressed)):
        raise RuntimeError(
            f"Artifacts for subject '{subject}' are not loaded. "
            "Run preprocessing, TF-IDF indexing, and SVD indexing first."
        )

    return records, vectorizer, docs_compressed, words_compressed


def resolve_subject(subject):
    """Maps subject aliases onto a concrete retrieval dataset."""
    if subject == "leetcode":
        raise ValueError("subject 'leetcode' is not supported. Use 'cs'.")
    if subject == "cs":
        return "leetcode"
    if subject == "math":
        return "math"
    raise ValueError("subject must be 'math' or 'cs'")


def build_leetcode_solution_url(record):
    """Returns a frontend-ready LeetCode solutions URL for a problem record."""
    problem_url = (record.get("url") or "").rstrip("/")
    if problem_url:
        return f"{problem_url}/solutions/"

    raw_solution_link = record.get("solution_link") or ""
    slug = raw_solution_link.replace("/articles/", "").strip("/")
    if slug:
        return f"https://leetcode.com/problems/{slug}/solutions/"

    return ""


def format_search_result(subject, record, score):
    """Shapes one retrieval result according to the selected subject."""
    if subject == "math":
        return {
            "problem_id": record["problem_id"],
            "problem_raw": record["problem_raw"],
            "answer": record["answer"],
            "similarity_score": score,
        }

    if subject == "leetcode":
        return {
            "problem_id": record["problem_id"],
            "title": record["title"],
            "description": record["description"],
            "difficulty": record["difficulty"],
            "acceptance_rate": record["acceptance_rate"],
            "url": record["url"],
            "solution_link": build_leetcode_solution_url(record),
            "companies": record["companies"],
            "related_topics": record["related_topics"],
            "similar_questions": record["similar_questions"],
            "similarity_score": score,
        }

    raise ValueError("subject must be 'math' or 'cs'")


def search_problems(app, subject, query, top_k=5):
    resolved_subject = resolve_subject(subject)

    records, vectorizer, docs_compressed, words_compressed = get_retrieval_artifacts(app, resolved_subject)

    query_text = build_combined_text(query)
    # Fold the query into the SVD space: transform via TF-IDF then project via V
    query_tfidf = vectorizer.transform([query_text])
    query_vec = normalize(query_tfidf.dot(words_compressed))
    ranked_matches = rank_by_cosine(query_vec, docs_compressed, top_k=top_k)

    results = []
    for document_index, score in ranked_matches:
        record = records[document_index]
        results.append(format_search_result(resolved_subject, record, score))

    return {
        "subject": subject,
        "query": query,
        "query_combined_text": query_text,
        "results": results,
    }



def register_routes(app):
    @app.route('/', defaults={'path': ''})
    @app.route('/<path:path>')
    def serve(path):
        if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
            return send_from_directory(app.static_folder, path)
        else:
            return send_from_directory(app.static_folder, 'index.html')

    @app.route("/api/config")
    def config():
        return jsonify({"use_llm": USE_LLM})

    @app.route("/api/episodes")
    def episodes_search():
        text = request.args.get("title", "")
        return jsonify(json_search(text))
    
    @app.route("/api/search", methods=["POST"])
    def search():
        payload = request.get_json(silent=True) or {}

        subject = payload.get("subject", "").strip().lower()
        query = payload.get("query", "").strip()
        top_k = payload.get("top_k", 5)

        if not subject:
            return jsonify({"error": "Missing 'subject' field."}), 400

        if not query:
            return jsonify({"error": "Missing 'query' field."}), 400

        try:
            top_k = int(top_k)
        except (TypeError, ValueError):
            return jsonify({"error": "'top_k' must be an integer."}), 400

        if top_k <= 0:
            return jsonify({"error": "'top_k' must be positive."}), 400

        try:
            response = search_problems(app, subject, query, top_k=top_k)
            return jsonify(response)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 500


    if USE_LLM:
        from llm_routes import register_chat_route
        register_chat_route(app, json_search)
