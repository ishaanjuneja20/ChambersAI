# Status
- [x] Statutes downloaded, Hindi OCR done
- [x] 38,366 judgments extracted and domain-tagged (92% agreement with model majority; no lawyer review)
- [x] Repo skeleton
- [x] Chunk English Acts (3,230 sections -> 3,713 chunks, 25 Acts; see docs/CHUNKING.md)
- [x] OCR all 22 Hindi PDFs (done on the Mac)
- [ ] Hindi chunks: deferred, OCR too noisy to align by section (see docs/CHUNKING.md); test Hindi->English retrieval instead
- [x] BNS<->IPC / BNSS<->CrPC citation mapping (numbers only; spot-checked, not lawyer-verified)
- [x] Data gaps fixed: HAMA s.4 and Contract Act s.24 recovered (chunker accepted no space after the dot); embeddings refreshed with tools/update_act_embeddings.py and checked on the Mac (both come back at rank 1)
- [x] BSA<->Evidence Act mapping (numbers only, from the Tripura govt comparison of the Act as passed; 170/170 sections, 2 new; chunks now read e.g. `BSA s.63 (formerly IEA s.65B)`; spot-checked, not lawyer-verified). The Evidence Act text itself is not in the corpus, so IEA-only questions are not answerable
- [x] Judgments indexed: 38,366 cards + 1,413,250 paragraph vectors (bge-m3, built on the GPU PC, verified on the Mac: counts match per year, vectors unit length)
- [~] Judgment retrieval: backend/rag/judgments.py written and unit-tested (2 stages, soft domain boost, citations from metadata); run on the real index (0.7 s load, ~0.02 s/query); 41 draft test questions (tests/eval/judgment_questions.json), right case in top 5 .69 (strict single-gold scoring), about 85% by manual reading; wired into pipeline.answer (answers with numbered citations tested on the Mac, EN + HI); refusal threshold 0.60 (question-as-asked) is provisional; needs lawyer-reviewed questions with all acceptable cases and harder traps
- [x] Draft test set (tests/eval/questions.json: 76 answerable + 20 trap questions, EN + HI) and tools/eval_embeddings.py; lexical baseline: EN hit@5 0.61, HI 0.00
- [x] Ran tfidf / e5-small / e5-base / bge-m3: bge-m3 chosen (EN hit@5 .92, HI .95). Gemini embeddings + query rewrite untested (free-tier rate limit)
- [ ] Lawyer review of the test set; add harder questions
- [x] retrieve() (bge-m3, boost .02, per-section, per-language refusal) + verify_citations; try it with tools/try_retrieve.py on the Mac
- [x] Gemini answer step (backend/rag/generate.py + pipeline.py), verified on the Mac with the real Gemini API (EN murder question, HI divorce question; model now gemini-flash-lite-latest with flash as fallback; key pool GEMINI_API_KEYS for demo). Query rewriting added (lift on everyday wording is large); thresholds retuned EN .64 / HI .60. Free Gemini key rate-limits: plan for a paid/billing-enabled key before the demo (2 Gemini calls per question)
- [ ] Per-domain test set with trap questions
- [ ] Voice (Fish Audio), avatars, frontend

## Parked for later (voice / hosting step; the RAG is the current task)
Agreed approach, not done yet. Remind the user when the team reaches the voice or hosting step.
- [ ] Voice: stream the answer sentence by sentence (`POST /ask/stream`, already built and unit-tested, not yet run against real Gemini; see docs/CONTRACTS.md); text-to-speech per sentence (Fish Audio streaming API still to be checked and timed); avatar mouth driven by the loudness of the playing audio (Web Audio, no GPU; code in docs/VOICE_FRONTEND.md). Target about 5 to 6 s from end of speech to first spoken word; about 10 to 12 s if not streamed.
- [ ] Hosting: run the backend on a laptop behind an HTTPS tunnel (Cloudflare quick tunnel to start); optionally a second laptop with the frontend trying backend URL 1 then 2. Frontend on a free static host. Oracle free VM as a later option.
- [ ] Before going public: per-visitor rate limit and a question length cap, CHAMBERS_DEBUG off, CORS for the frontend address, make sure nothing logs question text, a start script (pull repo, check the index folder, start server + tunnel).
- [ ] Gemini: billing-enabled key with a spending cap for real users (free keys may use prompts for training; only made-up demo questions on free keys). Rotate the keys pasted in chat.
- [ ] Time Fish Audio speech-to-text and text-to-speech; confirm the avatar method with the frontend teammates.
- [x] Other lawyers (consumer, property, labour, constitutional) run end to end, EN + HI: correct, 2-4 s each on the lite chain.
- [ ] Put the Dattam Labs (CC-BY-4.0) credit in the README and app.

## Resume notes
Chunks live on the data folder (`corpus/chunks/acts/`), not in git. Re-run `python3 tools/chunk_acts.py --root .` from `~/Desktop/RAG Datasets`; finished Acts are skipped.

## Where we stopped (2026-10-16, night)
- Review round 1 scored (3 AI reviewers). Pack rebuilt with real answers: 34/35 real questions answered, p05 (arrest memo; D.K. Basu not in top 3) refused = known retrieval miss, all 20 traps refused, no errors. The earlier 7 over-refusals were free-tier rate limits, not a pipeline bug.
- `corpus/review/send/SEND_part1..6.txt` regenerated (old ones in `send_round1/`); same candidates/key, only answers are new.
- Next: (1) send new SEND files to the reviewers (answer check only) or spot-check f08, f18, p02, f16, p03, p08 by hand; (2) rescore with tools/score_review.py; (3) pack still shows 600-char excerpts vs 3,500 seen by the model; (4) check Machhi Singh / Neeraja Chaudhary / Minerva Mills (1980) in the index; (5) false-premise traps t10/t17/t20 (refuse vs correct premise); (6) EN vs HI cheque-bounce inconsistency; (7) merge PRs #2 to #7 in order.
- Security: the Gemini key was pasted in chat repeatedly. Revoke it in Google AI Studio; new key only in `.chambers_env`.

## Where we stopped (2026-10-18): RAG frozen
- Second review round scored (2 full AI reviewers + 1 partial; reviewed set in tests/eval/judgment_questions.reviewed.json): 28 of 35 real questions have a case both reviewers accept; most "partly" verdicts come from the 600-character excerpts the reviewers saw.
- Two full runs (tools/run_answers.py, before and after the last changes): real questions answered 29 of 35 in both, traps refused 18-19 of 20. Remaining refusals: f03, p08, h01 and sometimes f08/h04/p10 (retrieval misses, see DECISIONS.md).
- `answer()`, `/ask` and `/ask/stream` output is FROZEN (docs/CONTRACTS.md, tests/test_contract.py). Backend/frontend/voice can build on it.
- Open, optional: add the two Muslim Women Acts to the family statutes (needs the official PDFs); a second look at the false-premise traps; lawyer review when a lawyer is available; Hindi judgment retrieval (h04 gets no judgments).
- Next for the team: frontend to /ask, voice (see Parked list above), hosting, rate limit, CORS.
- Merge order for the open PRs: #2 to #7, then the final-pass PR.
- Update (2026-10-18, evening): the 2019 Muslim Women Marriage Act is in (3,550 statute chunks); triple talaq (f08, h01) now answers from s.3 and s.2. The 1986 Act is held back (no official copy). Data is Mac-only: corpus/chunks/acts/MuslimWomenMarriageAct_2019.jsonl and the embeddings.
