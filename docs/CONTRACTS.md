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

## POST /ask
Request: `{"lawyer": "criminal", "question": "...", "lang": "en|hi"}`
Response: `{"answer": "...", "citations": [Chunk.citation...], "refused": false}`
`answer` carries numbered markers `[1]`, `[2, 3]` in order of first use; `citations[i-1]` is the full citation for marker `i`
(statute section, or case name + report + court + year + "from para N"). Show the list under the answer. For text-to-speech,
strip the markers with `re.sub(r"\s*\[\d+(?:,\s*\d+)*\]", "", answer)` so the voice does not read numbers aloud.

## GET /lawyers
List of entries from `lawyers.json`.
