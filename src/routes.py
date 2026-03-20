"""
Routes: React app serving and episode search API.

To enable AI chat, set USE_LLM = True below. See llm_routes.py for AI code.
"""
import json
import os
from flask import send_from_directory, request, jsonify
from models import db, Episode, Review
from lib.preprocess import build_combined_text
from lib.retrieval.cosine_similarity import rank_by_cosine


# ── AI toggle ────────────────────────────────────────────────────────────────
USE_LLM = False
# USE_LLM = True
# ─────────────────────────────────────────────────────────────────────────────


def json_search(query):
    if not query or not query.strip():
        query = "Kardashian"
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

def search_problems(app, subject, query, top_k=5):
    if subject == "math":
        records = app.config["MATH_RECORDS"]
        vectorizer = app.config["MATH_VECTORIZER"]
        matrix = app.config["MATH_TFIDF_MATRIX"]
    elif subject == "cs":
        return {
            "subject": subject,
            "query": query,
            "results": [],
            "message": "CS retrieval not implemented yet."
        }
    else:
        raise ValueError("subject must be 'math' or 'cs'")

    query_text = build_combined_text(query)
    query_vector = vectorizer.transform([query_text])
    ranked_matches = rank_by_cosine(query_vector, matrix, top_k=top_k)

    results = []
    for document_index, score in ranked_matches:
        record = records[document_index]
        results.append({
            "problem_id": record["problem_id"],
            "problem_raw": record["problem_raw"],
            "answer": record["answer"],
            "similarity_score": score,
        })

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


    if USE_LLM:
        from llm_routes import register_chat_route
        register_chat_route(app, json_search)
