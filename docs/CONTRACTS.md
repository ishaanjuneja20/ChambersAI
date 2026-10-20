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
- `refused: false` always has at least one citation, and every marker in `answer` has an entry in `citations`.
- The answer is in the language of the question (`lang`). Hindi answers end sentences with the danda `।`.
- Typical time: 2 to 4 s on the lite Gemini models (3 Gemini calls: two query rewrites in parallel, then the answer).
- Errors: unknown `lawyer` -> HTTP 404; Gemini unavailable -> HTTP 503 with a short message (show a retry message).
For text-to-speech, strip the markers with `re.sub(r"\s*\[\d+(?:,\s*\d+)*\]", "", answer)` so the voice does not read numbers aloud.
The app prefers a refusal to a guess: when the sources do not state what the court held or what the statute provides on the point asked,
it refuses. A question with a false premise (for example "which Article abolished the death penalty") is normally refused too; it is not corrected.

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
