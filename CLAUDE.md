# ChambersAI – project rules

Voice-enabled AI lawyers for Indian law (hackathon, 7 days). Stack: FastAPI, Gemini, custom RAG, Fish Audio (STT/TTS).

## Hard rules
1. Legal text comes from official sources only. No LLM-generated text in the corpus.
2. Citations (section, case name, year, court) come from retrieved chunk metadata, never from the model.
3. After generation, verify every cited section/case exists in the retrieved chunks; otherwise drop or regenerate.
4. If best similarity is below the threshold, refuse ("I don't have a reliable source for this").
5. Domain tags are a soft ranking boost, never a hard filter.
6. Client data is encrypted on the server. Never log plaintext client content.
7. Log every non-trivial choice in DECISIONS.md. Keep STATUS.md current.
8. Work on branches and open PRs; do not push to main.

## Layout
- `backend/main.py` FastAPI app (stubs)
- `backend/rag/retrieve.py` stub `retrieve()` – real format, fake data
- `lawyers.json` lawyer definitions
- `docs/CONTRACTS.md` data formats shared between teammates
