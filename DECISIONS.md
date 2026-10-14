# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-10 | Acts chunked per section; judgments per paragraph | exact citations, focused vectors |
| 2026-10 | Domain tags as soft boost | tags are model-labelled, unverified by a lawyer |
| OPEN | Hosting / vector store | ~900k judgment chunks exceed free tiers; consider int8 or case-level-first retrieval |
| 2026-10 | No OCR-based Hindi chunks yet; Hindi queries retrieve English chunks via multilingual embeddings | OCR drops digits and headings (only ~40-55% of sections alignable); noisy text would hurt retrieval and citations. Revisit if cross-lingual retrieval tests poorly |
| 2026-10 | Embedding model chosen by tools/eval_embeddings.py on the draft test set | picks on measured EN and HI hit@5 and the refusal threshold, not on reputation. Baseline (char TF-IDF): EN hit@5 0.61, HI 0.00 |
| 2026-10 | Embedding model: BAAI/bge-m3 (local, 1024-d) | Draft test set: EN hit@5 .92, HI hit@5 .95 (e5-base .82/.68, e5-small .82/.58, TF-IDF .61/0). Hindi questions find English sections without Hindi chunks. Gemini embeddings and Gemini query rewriting NOT tested (free-tier 429s); optional later |
| 2026-10 | Domain boost 0.02; one hit per section; per-language refusal thresholds EN 0.635, HI 0.589 | measured on the draft test set (traps refused 100% EN / 90% HI, real questions kept 89% / 84%). Thresholds are provisional until a lawyer-reviewed test set exists |
| 2026-10 | Answer text cites sources only by chunk id; citation strings come from chunk metadata; unknown ids are dropped, and no verifiable citation means refuse | CLAUDE.md rules 2-3 |
| 2026-10 | Embed queries on CPU, not Apple MPS | MPS gave wrong query vectors (sim 0.21 vs 0.71 for the same question on CPU); stored document vectors are fine. Re-ran the eval with --device cpu: identical scores, so the eval and thresholds are unaffected (batched queries were fine; the fault only hit single-query encoding) |
