---
name: p05-rag-chatbot
description: PoseCoach P05 — RAG chatbot with Gemini 3.5 Flash + Qwen 3.6 (OpenRouter) + ChromaDB. Smart routing between models. Auto-invoked when working on the chatbot, RAG pipeline, ChromaDB, Gemini, Qwen, or SSE streaming.
---

# P05 — RAG Chatbot (Gemini + Qwen 3.6 + ChromaDB)

## Goal
Build a dual-LLM coaching chatbot: exercise science RAG knowledge base in ChromaDB, smart routing between Gemini 3.5 Flash (text queries) and Qwen 3.6 via OpenRouter (visual/multimodal queries), streamed via SSE.

## Key Files
- `app/chatbot/` — chatbot module
- `app/chatbot/router.py` — smart model routing logic
- `app/chatbot/rag.py` — ChromaDB retrieval
- `app/chatbot/ingest.py` — knowledge base ingestion script
- `app/chatbot/llm.py` — unified `google-genai` Gemini 3.5 Flash + OpenRouter Qwen 3.6 clients
- `app/api/v1/chat.py` — SSE streaming endpoint
- `data/knowledge_base/` — exercise science documents

## Dual-LLM Architecture
```
User query + optional frame snapshot
    ↓
router.py — classify query type:
    - has_frame OR mentions visual → Qwen 3.6 (OpenRouter)
    - text only → Gemini 3.5 Flash (cheaper, faster)
    ↓
rag.py — retrieve top-3 chunks from ChromaDB
    ↓
LLM → SSE stream response
```

## Done Criteria
- [ ] ChromaDB populated with knowledge base
- [ ] Routing correctly sends visual queries to Qwen, text to Gemini
- [ ] SSE streaming works end-to-end in frontend
- [ ] `pytest tests/test_chatbot.py` green
- [ ] API keys in env vars, never hardcoded
