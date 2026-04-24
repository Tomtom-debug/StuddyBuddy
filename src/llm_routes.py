"""
LLM chat route — only loaded when USE_LLM = True in routes.py.
Adds POST /api/chat implementing the full RAG pipeline:
  1. LLM rewrites the user query into an IR-optimized search query
  2. IR retrieves top-k problems above the similarity threshold
  3. LLM synthesizes a streamed answer grounded in the retrieved context

SSE events emitted in order:
  { "ir_query": "..."  }       — the rewritten search query
  { "ir_results": [...]  }     — retrieved problems (same shape as /api/search)
  { "content": "..."  }        — streamed answer chunks
  { "error": "..."  }          — on failure
"""
import json
import os
import logging
from flask import request, jsonify, Response, stream_with_context
from infosci_spark_client import LLMClient

logger = logging.getLogger(__name__)


def _rewrite_query(client: LLMClient, user_message: str, subject: str) -> str:
    """Ask the LLM to produce a short IR-optimized keyword query."""
    domain = "math competition (AMC/AIME)" if subject == "math" else "LeetCode coding"
    messages = [
        {
            "role": "system",
            "content": (
                f"You are a search query optimizer for a {domain} problem database. "
                "Rewrite the user's question as a short keyword search query (5-10 words max) "
                "that will retrieve the most relevant problems. "
                "Return ONLY the query — no explanation, no punctuation at the end."
            ),
        },
        {"role": "user", "content": user_message},
    ]
    response = client.chat(messages, stream=False, show_thinking=False)
    return (response.get("content") or user_message).strip()


def _format_context(subject: str, results: list) -> str:
    """Format retrieved problems as plain text context for the LLM."""
    parts = []
    for i, r in enumerate(results, start=1):
        if subject == "math":
            parts.append(
                f"[{i}] Problem #{r['problem_id']} (similarity: {r['similarity_score']:.2f})\n"
                f"Problem: {r['problem_raw']}\n"
                f"Answer: {r['answer']}"
            )
        else:
            topics = ", ".join(r.get("related_topics") or [])
            parts.append(
                f"[{i}] {r['title']} (similarity: {r['similarity_score']:.2f})\n"
                f"Difficulty: {r.get('difficulty', 'N/A')}\n"
                f"Description: {r['description']}\n"
                f"Topics: {topics}"
            )
    return "\n\n---\n\n".join(parts)


def _get_problem_record(app, subject, problem_id):
    """Look up a single problem record from app.config by problem_id."""
    if subject == "math":
        records = app.config.get("MATH_RECORDS") or []
    else:
        records = app.config.get("LEETCODE_RECORDS") or []
    for r in records:
        if r.get("problem_id") == problem_id:
            return r
    return None


def register_chat_route(app, search_fn):
    """Register /api/chat and /api/explain. search_fn(subject, query, top_k) returns a search response dict."""

    @app.route("/api/chat", methods=["POST"])
    def chat():
        data = request.get_json() or {}
        user_message = (data.get("message") or "").strip()
        subject = (data.get("subject") or "math").strip().lower()

        if not user_message:
            return jsonify({"error": "Message is required"}), 400

        api_key = os.getenv("SPARK_API_KEY")
        if not api_key:
            return jsonify({"error": "SPARK_API_KEY not set — add it to your .env file"}), 500

        client = LLMClient(api_key=api_key)

        # If the caller provides context (e.g. follow-up on already-retrieved docs),
        # skip IR and use those documents directly.
        provided_context = data.get("provided_context")
        if provided_context and isinstance(provided_context, list) and len(provided_context) > 0:
            ir_query = "(follow-up on current results)"
            results = provided_context
        else:
            # Step 1: rewrite query for IR
            ir_query = _rewrite_query(client, user_message, subject)
            # Step 2: retrieve problems (already threshold-filtered by search_fn)
            search_response = search_fn(subject, ir_query, top_k=3)
            results = search_response.get("results", [])

        def generate():
            yield f"data: {json.dumps({'ir_query': ir_query})}\n\n"
            yield f"data: {json.dumps({'ir_results': results})}\n\n"

            if not results:
                yield (
                    f"data: {json.dumps({'content': 'I could not find any closely matching problems for your query. Try rephrasing with more specific terms.'})}\n\n"
                )
                return

            # Step 3: synthesize answer from retrieved context
            domain = "math competition (AMC/AIME)" if subject == "math" else "LeetCode coding"
            context = _format_context(subject, results)
            messages = [
                {
                    "role": "system",
                    "content": (
                        f"You are StudyBuddy, a helpful tutor for {domain} problems. "
                        "Answer ONLY using the retrieved problems provided. "
                        "Explain the underlying concept or technique, connect it to the retrieved problems, "
                        "and give the student clear advice on how to approach this type of problem. "
                        "Be concise — aim for 150 to 200 words. Never exceed 220 words. "
                        "Use plain text only."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Retrieved problems:\n\n{context}\n\n"
                        f"Student question: {user_message}"
                    ),
                },
            ]

            try:
                for chunk in client.chat(messages, stream=True, show_thinking=False):
                    if chunk.get("content"):
                        yield f"data: {json.dumps({'content': chunk['content']})}\n\n"
            except Exception as e:
                logger.error(f"Streaming error: {e}")
                yield f"data: {json.dumps({'error': 'Streaming error occurred'})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.route("/api/explain", methods=["POST"])
    def explain():
        data = request.get_json() or {}
        problem_id = data.get("problem_id")
        subject = (data.get("subject") or "math").strip().lower()
        mode = (data.get("mode") or "hint").strip().lower()

        if problem_id is None:
            return jsonify({"error": "problem_id is required"}), 400
        if mode not in ("hint", "walkthrough"):
            return jsonify({"error": "mode must be 'hint' or 'walkthrough'"}), 400

        api_key = os.getenv("SPARK_API_KEY")
        if not api_key:
            return jsonify({"error": "SPARK_API_KEY not set"}), 500

        resolved = "math" if subject == "math" else "leetcode"
        record = _get_problem_record(app, resolved, problem_id)
        if record is None:
            return jsonify({"error": f"Problem {problem_id} not found"}), 404

        client = LLMClient(api_key=api_key)

        if subject == "math":
            problem_text = record.get("problem_raw", "")
            answer_text = record.get("answer", "")
            target_context = (
                f"Problem #{problem_id}:\n{problem_text}\nAnswer: {answer_text}"
            )
        else:
            problem_text = record.get("description", "")
            target_context = (
                f"{record.get('title', '')} (Difficulty: {record.get('difficulty', 'N/A')})\n"
                f"{problem_text}"
            )

        search_response = search_fn(subject, problem_text[:300], top_k=3)
        similar = [r for r in search_response.get("results", []) if r.get("problem_id") != problem_id][:2]

        domain = "math competition (AMC/AIME)" if subject == "math" else "LeetCode coding"
        similar_context = _format_context(resolved, similar) if similar else ""

        if mode == "hint":
            instruction = (
                "Give the student ONE helpful hint for solving this problem. "
                "Do NOT reveal the full solution or final answer. "
                "Point them toward the key insight or technique needed."
            )
        else:
            instruction = (
                "Walk the student through the complete solution step by step. "
                "Explain the reasoning at each step clearly."
            )

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are StudyBuddy, a helpful tutor for {domain} problems. "
                    f"{instruction} "
                    "Be concise and educational. Use plain text only."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Target problem:\n\n{target_context}"
                    + (f"\n\nSimilar problems for context:\n\n{similar_context}" if similar_context else "")
                ),
            },
        ]

        def generate():
            if similar:
                yield f"data: {json.dumps({'ir_results': similar})}\n\n"
            try:
                for chunk in client.chat(messages, stream=True, show_thinking=False):
                    if chunk.get("content"):
                        yield f"data: {json.dumps({'content': chunk['content']})}\n\n"
            except Exception as e:
                logger.error(f"Explain streaming error: {e}")
                yield f"data: {json.dumps({'error': 'Streaming error occurred'})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
