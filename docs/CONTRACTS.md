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
{"answer": "Murder is punished with death or life imprisonment [1]. The court held ... [2]. This is general information, not a substitute for a licensed advocate.",
 "citations": ["BNS s.103 (formerly IPC s.302)", "A v. B, [2001] 1 S.C.R. 9 (Supreme Court of India, 2001), from para 3"],
 "refused": false}
```
Rules the frontend and voice code can rely on (locked by `tests/test_contract.py`):
- `answer` carries numbered markers `[1]`, `[2, 3]` in order of first use, starting at 1 with no gaps; `citations[i-1]` is the full
  citation for marker `i` (statute section, or case name + report + court + year + "from para N"). Show the list under the answer.
  Internal ids never appear in `answer`.
- `refused: true` means no reliable source: `citations` is `[]` and `answer` is exactly
  `"I don't have a reliable source for this."` (English) or `"इस विषय पर मेरे पास कोई विश्वसनीय स्रोत नहीं है।"` (Hindi). Show it as is.
- `refused: false` always has at least one citation, and every marker in `answer` has an entry in `citations`.
- The answer is in the language of the question (`lang`). Hindi answers end sentences with the danda `।`.
- Typical time: 2 to 4 s on the lite Gemini models (3 Gemini calls: two query rewrites in parallel, then the answer).
- Errors: unknown `lawyer` -> HTTP 404; Gemini unavailable -> HTTP 503 with a short message (show a retry message).
For text-to-speech, strip the markers with `re.sub(r"\s*\[\d+(?:,\s*\d+)*\]", "", answer)` so the voice does not read numbers aloud.
A mistaken premise in the question (for example "which Article abolished the death penalty") is corrected from the sources when a source
states the opposite; if no source does, the answer is a refusal. A refusal is never wrong, only unhelpful: the app prefers it to guessing.

Not part of the contract (may change without notice): which sources are retrieved, similarity thresholds, the Gemini models, the wording of the
disclaimer sentence, answer length, the content of `debug`.

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
