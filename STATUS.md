# Status
- [x] Statutes downloaded, Hindi OCR done
- [x] 38,366 judgments extracted and domain-tagged (92% agreement with model majority; no lawyer review)
- [x] Repo skeleton
- [x] Chunk English Acts (3,230 sections -> 3,713 chunks, 25 Acts; see docs/CHUNKING.md)
- [x] OCR all 22 Hindi PDFs (done on the Mac)
- [ ] Hindi chunks: deferred, OCR too noisy to align by section (see docs/CHUNKING.md); test Hindi->English retrieval instead
- [x] BNS<->IPC / BNSS<->CrPC citation mapping (numbers only; spot-checked, not lawyer-verified)
- [ ] BSA<->Evidence Act mapping (no table yet)
- [x] Judgments indexed: 38,366 cards + 1,413,250 paragraph vectors (bge-m3, built on the GPU PC, verified on the Mac: counts match per year, vectors unit length)
- [~] Judgment retrieval: backend/rag/judgments.py written and unit-tested (2 stages, soft domain boost, citations from metadata); run on the real index (0.7 s load, ~0.02 s/query); 41 draft test questions (tests/eval/judgment_questions.json), right case in top 5 .69 (strict single-gold scoring), about 85% by manual reading; NOT yet wired into pipeline.py/generate.py; refusal threshold 0.60 (question-as-asked) is provisional; needs lawyer-reviewed questions with all acceptable cases and harder traps
- [x] Draft test set (tests/eval/questions.json: 76 answerable + 20 trap questions, EN + HI) and tools/eval_embeddings.py; lexical baseline: EN hit@5 0.61, HI 0.00
- [x] Ran tfidf / e5-small / e5-base / bge-m3: bge-m3 chosen (EN hit@5 .92, HI .95). Gemini embeddings + query rewrite untested (free-tier rate limit)
- [ ] Lawyer review of the test set; add harder questions
- [x] retrieve() (bge-m3, boost .02, per-section, per-language refusal) + verify_citations; try it with tools/try_retrieve.py on the Mac
- [x] Gemini answer step (backend/rag/generate.py + pipeline.py), verified on the Mac with the real Gemini API (EN murder question, HI divorce question; model gemini-flash-latest, retries on 503). Query rewriting added (lift on everyday wording is large); thresholds retuned EN .64 / HI .60. Free Gemini key rate-limits: plan for a paid/billing-enabled key before the demo (2 Gemini calls per question)
- [ ] Per-domain test set with trap questions
- [ ] Voice (Fish Audio), avatars, frontend

## Resume notes
Chunks live on the data folder (`corpus/chunks/acts/`), not in git. Re-run `python3 tools/chunk_acts.py --root .` from `~/Desktop/RAG Datasets`; finished Acts are skipped.
