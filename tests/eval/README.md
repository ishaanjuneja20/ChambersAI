# Retrieval test set (DRAFT)

`questions.json`: 76 answerable questions (38 pairs, English and Hindi) across the six domains, plus 20 trap questions (10 pairs) that the corpus cannot answer.

- `gold` lists the sections a correct retrieval should return, as `<act_short>:<section>` (any chunk of that section counts). Every gold section was checked to exist in the chunk files.
- `lawyer` is the lawyer the question is asked to (used for the domain boost test).
- Traps: the right behaviour is to refuse. Their gold list is empty.

Status: drafted by Claude, not reviewed by a lawyer. Gold sections are the obvious ones; a lawyer should check them and add harder, realistic questions (this set is deliberately easy and mostly one question to one section). Teammates should add questions in the same format.

Run: `python3 tools/eval_embeddings.py --root . --models tfidf e5-small`
