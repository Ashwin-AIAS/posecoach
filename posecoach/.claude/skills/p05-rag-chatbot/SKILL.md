---
name: p05-rag-chatbot
description: PoseCoach P05 — RAG chatbot with Gemini 2.0 Flash + Qwen 3.6 (OpenRouter) + ChromaDB. Smart routing between models. Auto-invoked when working on the chatbot, RAG pipeline, ChromaDB, Gemini, Qwen, or SSE streaming.
allowed-tools: Read, Write, Edit, Bash
---

# P05 — RAG Chatbot (Gemini + Qwen 3.6 + ChromaDB)

## Goal
Build a dual-LLM coaching chatbot: exercise science RAG knowledge base in ChromaDB, smart routing between Gemini 2.0 Flash (text queries) and Qwen 3.6 via OpenRouter (visual/multimodal queries), streamed via SSE.

## Key Files
- `app/chatbot/` — chatbot module
- `app/chatbot/router.py` — smart model routing logic
- `app/chatbot/rag.py` — ChromaDB retrieval
- `app/chatbot/ingest.py` — knowledge base ingestion script
- `app/chatbot/gemini_client.py` — Gemini 2.0 Flash client
- `app/chatbot/qwen_client.py` — Qwen 3.6 via OpenRouter client
- `app/api/v1/chat.py` — SSE streaming endpoint
- `data/knowledge_base/` — exercise science PDFs/text

## Dual-LLM Architecture
```
User query + optional frame snapshot
    ↓
router.py — classify query type:
    - has_frame OR mentions visual → Qwen 3.6 (OpenRouter)
    - text only → Gemini 2.0 Flash (cheaper, faster)
    ↓
rag.py — retrieve top-3 chunks from ChromaDB
    ↓
LLM → SSE stream response
```

## Qwen 3.6 Integration (⭐ Key Feature)
- Provider: OpenRouter API (`OPENROUTER_API_KEY` env var)
- Model ID: `qwen/qwen-2.5-vl-7b-instruct` (or latest Qwen 3.6 ID on OpenRouter)
- Capabilities Qwen adds that YOLO can't: grip width, bar path, foot placement, equipment identification
- Send frame snapshot as base64 image in message content

## RAG Setup
- Vector DB: ChromaDB (local persistent)
- Embedding model: `all-MiniLM-L6-v2` (sentence-transformers)
- Knowledge base: exercise science papers, form guides (from `data/knowledge_base/`)
- Retrieval: top-3 chunks, cosine similarity
- Run ingestion: `python -m app.chatbot.ingest`

## SSE Endpoint
- `GET /api/v1/chat/stream?query=...&session_id=...`
- Optional: `frame` parameter (base64 JPEG) triggers Qwen routing
- Stream format: `data: {"token": "...", "done": false}\n\n`

## Done Criteria
- [ ] ChromaDB populated with knowledge base
- [ ] Routing correctly sends visual queries to Qwen, text to Gemini
- [ ] SSE streaming works end-to-end in frontend
- [ ] `pytest tests/test_chatbot.py` green
- [ ] API keys in env vars, never hardcoded

## Thesis Metric
- Chatbot relevance score (RAG retrieval quality, rated by evaluators > 4.0/5)
- Response latency for text vs. visual queries
