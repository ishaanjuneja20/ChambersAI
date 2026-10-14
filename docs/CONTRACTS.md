# Contracts

Agree on these first so four people can work in parallel.

## Chunk (stored in the index)
```json
{
  "id": "bns-103",
  "kind": "act_section | judgment_para",
  "text": "...",
  "lang": "en | hi",
  "domains": ["criminal"],
  "citation": "BNS s.103 (formerly IPC s.302)",
  "meta": {"act": "BNS", "section": "103", "case_name": null, "year": null, "court": null, "source_path": "statutes/criminal/BNS_2023.pdf"}
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

## GET /lawyers
List of entries from `lawyers.json`.
