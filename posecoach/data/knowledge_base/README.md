# Knowledge Base — PoseCoach RAG

This folder contains curated exercise science documents for the PoseCoach chatbot's RAG pipeline.

## How It Works
Files here are chunked, embedded with `all-MiniLM-L6-v2`, and stored in ChromaDB.
When a user asks a coaching question, the top-3 most relevant chunks are retrieved
and fed as context to the LLM (Gemini or Qwen).

## File Structure
- One markdown file per exercise (7 total)
- `general_coaching.md` — universal training principles
- Each file has consistent sections for clean chunking

## Regenerating ChromaDB
After editing any file here:
```bash
python -m app.chatbot.ingest
```

## Adding Your Own Sources
Each file has `[TODO: ADD SOURCE]` placeholders. Replace these with:
- Angle ranges from your Vicon/Fit3D data
- NSCA or ACSM textbook references
- Paper citations from your literature survey
