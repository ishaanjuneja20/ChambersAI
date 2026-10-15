# Retrieval test set (DRAFT)

`questions.json`: 76 answerable questions (38 pairs, English and Hindi) across the six domains, plus 20 trap questions (10 pairs) that the corpus cannot answer.

- `gold` lists the sections a correct retrieval should return, as `<act_short>:<section>` (any chunk of that section counts). Every gold section was checked to exist in the chunk files.
- `lawyer` is the lawyer the question is asked to (used for the domain boost test).
- Traps: the right behaviour is to refuse. Their gold list is empty.

Status: drafted by Claude, not reviewed by a lawyer. Gold sections are the obvious ones; a lawyer should check them and add harder, realistic questions (this set is deliberately easy and mostly one question to one section). Teammates should add questions in the same format.

Run: `python3 tools/eval_embeddings.py --root . --models tfidf e5-small`

## questions_lay.json (DRAFT, everyday wording)
30 answerable questions (15 pairs, English and Hindi) and 8 trap questions, written the way a member of the public would ask, with no legal terms. `questions.json` is deliberately easy; this set is closer to real use and is what refusal thresholds and query rewriting should be judged on. Same format, same caveat: not reviewed by a lawyer.
Run: `python3 tools/eval_embeddings.py --root . --models bge-m3 --device cpu --questions tests/eval/questions_lay.json --tag @lay`

## judgment_questions.json (DRAFT, not lawyer reviewed)
41 questions against the Supreme Court judgment index: `find_case` (issue described in everyday words, the answer is a
case), `point` (a specific point inside a case; also lists the gold paragraphs), `trap` (nothing in the judgments).
Gold cases were checked against the judgment text. The landmark_matches.csv entries for D.K. Basu and Bachan Singh
point to short reports, so the full judgments (S_1996_10_284_320, 1983_1_145_371) are used here.
Run with `tools/eval_judgments.py`. Lawyers should review the wording and the gold cases before the numbers are trusted.
