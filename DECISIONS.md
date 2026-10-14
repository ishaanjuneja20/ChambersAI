# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10 | Acts chunked per section; judgments per paragraph | exact citations, focused vectors |
| 2026-10 | Domain tags as soft boost | tags are model-labelled, unverified by a lawyer |
| OPEN | Embedding model (Gemini embeddings vs local multilingual) | must retrieve English chunks from Hindi queries; test both |
| OPEN | Hosting / vector store | ~900k judgment chunks exceed free tiers; consider int8 or case-level-first retrieval |
| 2026-10 | No OCR-based Hindi chunks yet; Hindi queries retrieve English chunks via multilingual embeddings | OCR drops digits and headings (only ~40-55% of sections alignable); noisy text would hurt retrieval and citations. Revisit if cross-lingual retrieval tests poorly |
