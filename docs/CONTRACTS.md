# Contracts

Agree on these first so four people can work in parallel.

## Chunk (stored in the index)
```json
{
  "id": "bns-103",
  "kind": "act_section | act_article | act_schedule | judgment_para",
  "text": "...",
  "lang": "en | hi",
  "domains": ["criminal"],
  "citation": "BNS s.103 (formerly IPC s.302)",
  "meta": {"act": "Bharatiya Nyaya Sanhita, 2023", "act_short": "BNS_2023", "section": "103", "title": "Punishment for murder", "chapter": "CHAPTER VI ...", "part": null, "case_name": null, "year": 2023, "court": null, "source_path": "statutes/criminal/BNS_2023_en.pdf", "footnotes": []}
}
```
Acts: one chunk per section. Judgments: one chunk per paragraph (case name/year/court in meta).

## retrieve(query, lawyer_domain, k) -> list[Hit]
```json
{"chunk": {...Chunk...}, "score": 0.0}
```
Sorted by score descending. Domain match boosts score; it does not filter.

## POST /ask  (FROZEN, 2026-10-18)
Request: `{"lawyer": "criminal", "question": "...", "lang": "en|hi"}`  (`lang` optional: detected from the question)
Response, exactly these three keys (a fourth key `debug` appears only when the server runs with `CHAMBERS_DEBUG=1`; never rely on it):
```json
{"answer": "Murder is punished with death or life imprisonment [1]. The court held ... [2].",
 "citations": ["BNS s.103 (formerly IPC s.302)", "A v. B, [2001] 1 S.C.R. 9 (Supreme Court of India, 2001), from para 3"],
 "refused": false}
```
Rules the frontend and voice code can rely on (locked by `tests/test_contract.py`):
- `answer` carries numbered markers `[1]`, `[2, 3]` in order of first use, starting at 1 with no gaps; `citations[i-1]` is the full
  citation for marker `i` (statute section, or case name + report + court + year + "from para N"). Show the list under the answer.
  Internal ids never appear in `answer`.
- `refused: true` means no reliable source: `citations` is `[]` and `answer` is exactly
  `"I don't have a reliable source for this."` (English) or `"इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"` (Hindi). Show it as is.
- `refused: false` always has at least one citation, and every marker in `answer` has an entry in `citations`, except a general-guidance
  answer (below), which is marked `"general": true` and has `citations: []`.
- The answer is in the language of the question (`lang`). Hindi answers end sentences with the danda `।`.
- Typical time: 2 to 4 s on the lite Gemini models (3 Gemini calls: two query rewrites in parallel, then the answer).
- Errors: unknown `lawyer` -> HTTP 404; Gemini unavailable -> HTTP 503 with a short message (show a retry message).
For text-to-speech, strip the markers with `re.sub(r"\s*\[\d+(?:,\s*\d+)*\]", "", answer)` so the voice does not read numbers aloud.
The app prefers a refusal to a guess: when the sources do not state what the court held or what the statute provides on the point asked,
it refuses. A question with a false premise (for example "which Article abolished the death penalty") is normally refused too; it is not corrected.

Not part of the contract (may change without notice): which sources are retrieved, similarity thresholds, the Gemini models, the wording of the
disclaimer sentence, answer length, the content of `debug`.

### General guidance (tier 2)  (2026-10-22; additive)
Where `/ask` and `/ask/stream` would refuse because nothing cleared the similarity threshold or the model answered `NO_SOURCE`, the server may
instead return a short **general guidance** reply (one extra Gemini call). It is unverified general information, not a sourced answer.
`CHAMBERS_GENERAL=0` turns it off (every such case is then the standard refusal). A cited answer is exactly as before and never has a `general` key.
```json
{"answer": "Your employer cannot simply stop your pay without a proper process. You can first write to them, and if that fails, approach the labour commissioner. It is wise to consult a lawyer about your specific case.",
 "citations": [], "refused": false, "general": true}
```
- The reply is in the user's language, at most about 80 words, plain sentences: concepts, who to approach, typical steps, ending with a suggestion to
  consult a lawyer. Show it as general information (for example with an "unverified, not legal advice" label), not as a sourced answer.
- Checked in code before it is returned: it has no digits, no "section"/"article" (or Hindi धारा/अनुच्छेद), no "v."/"vs."/"versus"/बनाम, no Rs/₹/rupees/percent,
  and is not `OUT_OF_SCOPE` (the model's answer for a question that is not about Indian law: cooking, coding, medical, tax filing, other countries).
  A reply that fails the check, or a failed model call, gives the standard refusal below unchanged.
- `/ask`: `refused: false`, `citations: []`, `general: true`. Do not look for `[n]` markers.
- `/ask/stream`: each `sentence` event has `"general": true` and `new_citations: []` (`text` and `speak` are the same), then
  `{"type":"done","citations":[],"general":true}`. The whole reply is checked before the first sentence is sent, so a rejected one is a single `refused` event, as before.
- With `CHAMBERS_DEBUG=1`, `debug` also has `general_attempt` (was the call made), `general` (was its reply used) and `general_outcome`
  (`used`, `error`, `out_of_scope`, `digit`, `section_or_article`, `case_name`, `amount`, `no_source`, `empty`); labels only, never the reply text.
- Not covered: an answer where the model replied without a valid citation (still the standard refusal), and document questions (`/sessions/{id}/ask/stream`).

## GET /lawyers
List of entries from `lawyers.json`.

## POST /ask/stream (voice)  (FROZEN, 2026-10-18)
Request: same as `/ask`, plus `"voice": true` (default; asks for a short answer, about 90 words, that sounds right spoken).
Response: `text/event-stream`. Each `data:` line is one JSON event:
- `{"type":"sentence","text":"... [1].","speak":"... .","new_citations":[{"n":1,"text":"HMA s.13"}]}`
  one verified sentence. Show `text` on screen, send `speak` (no markers) to text-to-speech, add `new_citations` to the list.
- `{"type":"done","citations":[...]}` end of the answer (the full numbered list).
- `{"type":"refused","answer":"I don't have a reliable source for this."}` nothing was sent before this; speak the text.
- `{"type":"error","message":"..."}` Gemini failed; show a retry message.
Nothing is sent until a sentence with a valid citation exists, so a refusal never arrives after speech has started.
Browser example and the mouth-from-loudness lip sync: `docs/VOICE_FRONTEND.md`.

## POST /api/speak (lip-sync speech)  (2026-10-20)
Request: `{"text": "...", "lawyer_id": "constitutional", "lang": "en" | "hi" | null}`. One sentence or clause, exactly as it should be spoken (max 1000 chars). `lang` goes to Fish Audio for text normalisation and alignment.
Response:
```json
{"audio_base64": "<mp3>", "format": "mp3",
 "timing": {"source": "fish-timestamps" | "none",
            "segments": [{"text": "My", "start": 0.0, "end": 0.32}, ...]}}
```
- Audio and timing come from one Fish Audio call (`/v1/tts/stream/with-timestamp`, same model and voice as `/api/test-tts`), so the times refer to this exact MP3. Seconds from the start of the audio.
- Granularity observed: one segment per word for Latin script; for Devanagari one segment per syllable with the vowel signs dropped (`पुलिस` -> `प`, `ल`, `स`); segments can be zero-length; the first segment is pinned to 0.0 even when the audio starts with silence. No phoneme timing.
- `source: "none"` means Fish sent no alignment; the frontend then places phones on the audio alone.
- 400 empty/too long text or unknown lawyer, 422 bad `lang`, 502 Fish failed, 503 voice keys missing.
The frontend (`frontend/src/lib/speech/fishSpeech.ts`) splits answers into sentences, calls this per sentence and turns text + segments + decoded audio into a viseme timeline (`frontend/src/lib/lipsync/`).

## LLM providers: Groq first, Gemini fallback  (2026-10-22; `/ask` and `/ask/stream` are unchanged)
Every model call (query rewrite, Hinglish translation, written answer, voice answer, general guidance) goes through `backend/rag/generate.py` `call_llm` / `stream_llm`. Same prompts, same `NO_SOURCE` and citation checks, same `/ask/stream` events (`sentence`, `done`, `refused`, `error`); only where the text comes from changes. Document analysis and questions about an uploaded document (`/sessions/{id}/...`) stay on Gemini only: a client's document is not sent to a second provider.

| Setting (env, backend/.env) | Meaning |
|---|---|
| `GROQ_API_KEY` | Groq key (also used for Whisper). Without it Groq is left out silently. |
| `GROQ_CHAT_MODELS` | comma-separated, tried in order; default `openai/gpt-oss-120b,openai/gpt-oss-20b` |
| `CHAMBERS_LLM_ORDER` | `groq,gemini` (default), `gemini,groq` or `gemini`; unknown names are ignored |
| `GROQ_QUESTIONS_PER_MIN` / `GROQ_TOKENS_PER_MIN` | the Groq budget per model over a rolling 60 s: default 2 questions or 7000 tokens (`usage.total_tokens`) |
| `GROQ_MAX_WAIT` | seconds a new question may wait for budget before going to Gemini; default 15 |
| `CHAMBERS_GROQ_BUDGET` | `0` turns the budget off (Groq is used until Groq itself answers 429) |

- Groq: `POST https://api.groq.com/openai/v1/chat/completions` (httpx), 8 s per attempt, `reasoning_effort: "low"`, `max_completion_tokens` = the answer's size (400 for answers, 300 general guidance, 200 rewrites) + 600 for reasoning. Models are never listed or probed.
- A Groq attempt fails over (next Groq model, then the Gemini rotation unchanged) on a timeout, 429, 5xx, network error, empty reply, a reply cut off at the token limit, or any other error status.
- A 429 skips that model for the seconds in its `retry-after` header (30 if none); a timeout, network error or 5xx skips it for 30 s; 401/403 for 300 s; a 404 drops it until restart. Limits are per model, so the next Groq model is still tried after a 429.
- Budget (`backend/rag/groq_budget.py`): a NEW question that finds the budget used up waits (in 0.5 s steps) until the oldest counted question or tokens leave the window, if that is at most `GROQ_MAX_WAIT`; otherwise it goes straight to the Gemini rotation. A question counts once, on its first call to a model; its later calls (rewrite, answer, retry, general guidance) are never held back. While `/ask/stream` and `/sessions/{id}/ask/stream` wait they send an SSE comment, `: waiting`, at the start and every 3 s. A comment line is not an event: the events and their names are unchanged, and a client that ignores comments (the frontend does) sees nothing but the delay.
- Voice (`/ask/stream`): Groq's reply is fetched whole (0.1-0.5 s) and handed to the same sentence splitter as one piece, so an empty or cut-off reply falls back before anything is spoken.
- `CHAMBERS_TRACE=1` prints one stderr line per Groq attempt, e.g. `[llm] groq openai/gpt-oss-120b -> ok in 0.6s (3831 prompt + 243 completion tokens)` or `-> 429 in 0.3s, falling back` (provider, model, outcome, seconds, token counts; never a key or any question or answer text). Gemini attempts keep their `[gemini] model=... key=...` lines.
- Prompt: a source whose text is already inside an earlier source's text is not sent twice (`generate._distinct`); `hits`, citations and retrieval are unchanged.

## Document analysis (text PDFs)  (2026-10-22; `/ask` and `/ask/stream` are unchanged)
Code: `backend/docs_store.py`, `backend/docs_routes.py`, `backend/rag/docqa.py`. Tests: `tests/test_docs.py`.

### POST /sessions/{session_id}/documents
`multipart/form-data`, field `file` (a PDF), optional field `lang` (`en` | `hi`: the language of the analysis; default: the document's own).
`session_id`: 1 to 64 letters, digits, `_` or `-` (the frontend's session id). Limits: file <= 10 MB, starts with `%PDF`, <= 60 pages, 3 documents per session.
Response 200 (one Gemini call):
```json
{"doc_id": "9f3a1c5e7b20", "filename": "rent.pdf", "pages": 2,
 "analysis": {"title": "...", "summary": "<= 120 words", "key_points": ["..."], "legal_issues": ["..."], "risks": ["..."], "dates_and_amounts": ["..."]}}
```
Every list holds at most 10 short strings and may be empty. The analysis only describes what the document says: no section numbers or case names, no legal advice.
Errors (`{"detail": "..."}`): 400 not a PDF or bad session id, 409 already 3 documents, 413 over 10 MB, 422 scanned PDF (`"This looks like a scanned PDF. Only text PDFs are supported."`), more than 60 pages, password protected or unreadable, 503 Gemini unavailable (nothing is stored; try again).

### DELETE /sessions/{session_id}/documents/{doc_id}
`{"deleted": true}`, or 404 if it does not exist (or has expired).

### POST /sessions/{session_id}/ask/stream
Request: `{"lawyer": "property", "question": "...", "lang": "en|hi", "voice": true}` (same as `/ask/stream`). Response: `text/event-stream` with EXACTLY the events of `/ask/stream`
(`sentence` with `text`, `speak`, `new_citations`; `done` with `citations`; `refused`; `error`), so the voice and caption code needs no change.
Without documents in the session it IS `/ask/stream` (same code). With documents:
- The prompt has the documents (untrusted data, with `[page N]` markers) and the retrieved law sources. Law retrieval uses the question; the query rewrite also sees a short description of the document.
- A fact about the user's own document carries `(page N)` in `text` (`(document D, page N)` when the session has several documents), never a `[n]`. A page that does not exist is dropped by the backend. `speak` has neither the page markers nor the `[n]` markers.
- A statement about what the law says carries a numbered `[n]` citation, verified with `verify_citations` exactly as in `/ask` (the model only writes chunk ids). `new_citations` and `done.citations` hold law citations only.
- A sentence counts as sourced when it has a verified `[n]` or a valid page marker. As in the normal stream nothing is sent until one has appeared; if none ever does, or the model answers `NO_SOURCE` (neither the document nor the law answers), the stream is a single `refused` event.
- An answer from the document alone is possible even when no law source matched (every statement about the law still needs one).
- ~90 words when `voice` is true.
- 404 unknown lawyer, 400 bad session id.

### Privacy
- The extracted text, the file name and the analysis are encrypted (Fernet) before they are kept, and kept in server MEMORY only: never written to disk. Key: `DOCS_ENCRYPTION_KEY` (generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`); without it an ephemeral key is generated at startup. Either way all documents are lost when the server restarts.
- Documents expire 24 hours after upload (`DELETE` removes one at once). A session's documents are only used for questions asked with that session id.
- Document text and file names are never logged; log lines carry the short `doc_id` and page counts. Document text is sent to Gemini (for the analysis and for each question about it): the frontend says so next to the attach button.
- The document is treated as untrusted data in every prompt (see DECISIONS.md).
