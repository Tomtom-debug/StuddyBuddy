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


def register_chat_route(app, search_fn):
    """Register /api/chat. search_fn(subject, query, top_k) returns a search response dict."""

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
                        "Be concise. Use plain text only."
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
