# Status
- [x] Statutes downloaded, Hindi OCR done
- [x] 38,366 judgments extracted and domain-tagged (92% agreement with model majority; no lawyer review)
- [x] Repo skeleton
- [x] Chunk English Acts (3,230 sections -> 3,713 chunks, 25 Acts; see docs/CHUNKING.md)
- [ ] Chunk Hindi Acts (5 Acts have usable OCR; the rest need OCR)
- [ ] BNS<->IPC / BNSS<->CrPC citation mapping
- [ ] Chunk judgments
- [ ] Pick embedding model, build index
- [ ] Retrieval + refusal threshold + citation check
- [ ] Per-domain test set with trap questions
- [ ] Voice (Fish Audio), avatars, frontend

## Resume notes
Chunks live on the data folder (`corpus/chunks/acts/`), not in git. Re-run `python3 tools/chunk_acts.py --root .` from `~/Desktop/RAG Datasets`; finished Acts are skipped.
