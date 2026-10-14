# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10 | Acts chunked per section; judgments per paragraph | exact citations, focused vectors |
| 2026-10 | Domain tags as soft boost | tags are model-labelled, unverified by a lawyer |
| OPEN | Embedding model (Gemini embeddings vs local multilingual) | must retrieve English chunks from Hindi queries; test both |
| OPEN | Hosting / vector store | ~900k judgment chunks exceed free tiers; consider int8 or case-level-first retrieval |
