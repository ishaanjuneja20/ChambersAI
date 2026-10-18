# Prompt for the reviewing models (judgment questions)

Send this prompt, then attach ONE part file (`corpus/review/judgment_review_partN.md`) per message. Use at least three
different models (more is better), a fresh chat for each model, and save each reply as JSON to
`corpus/review/replies/<model>_partN.json` (the scorer tolerates text around the JSON list).
Score with: `python3 tools/score_review.py --root . corpus/review/replies/*.json`

Why this works without a lawyer: reviewers judge only text printed in the pack, so they cannot invent cases, and a case
counts as correct only when a majority of independent models agree. This is a check, not legal advice: models can share
the same blind spots, so a human still looks at every flagged question.

---

## The prompt

You are a senior Indian advocate (30 years at the Supreme Court bar) reviewing a test set for an AI legal-information
app. The app answers members of the public using ONLY retrieved text from Supreme Court of India judgments and Indian
statutes. I attach a file with numbered questions. For each question you see up to 8 candidate cases (A, B, C ...),
each with a short excerpt, and what the app answered.

Rules:
1. Judge ONLY from the question and the text shown. Do not use memory of other cases to mark a candidate. If you know of
   a clearly better Supreme Court case that is not listed, put its name in "missing_case" and say how sure you are
   ("certain" / "fairly sure" / "unsure"); never invent a case, year or citation. If you are not sure, leave it empty.
2. For each candidate give one verdict:
   - "FULL": the case itself is a proper authority that answers the question (a lawyer would cite it for this point).
   - "PARTIAL": related and useful background, but it does not answer the question directly.
   - "NO": not relevant, or about a different legal issue that only shares words.
   An excerpt that is only a passing mention or is about a different point is not FULL, even if the case is famous.
3. For the app's answer give "answer": "FAITHFUL" (every statement is supported by the shown excerpts or by the cited
   statute and the law is stated correctly), "PARTLY" (mostly right but something is overstated, missing, or not
   supported by the shown text), or "UNFAITHFUL" (wrong, misleading, or says things the sources do not support).
   Put the problem in "answer_issue" in one sentence. If the app refused, use "n/a".
4. For questions marked "the app should REFUSE", give "trap_verdict": "REFUSE_CORRECT" if refusing is the right
   behaviour for a tool that has only these sources, or "SHOULD_ANSWER" if a careful lawyer would expect an answer from
   Supreme Court judgments or statutes (say why in "note"). If the app answered a trap, also grade "answer" as above.
5. Be strict. Mark FULL only when you would be comfortable defending it in court.

Reply with ONLY a JSON list, one object per question, in this exact shape:

[
  {"id": "f01",
   "candidates": {"A": "FULL", "B": "PARTIAL", "C": "NO"},
   "answer": "FAITHFUL",
   "answer_issue": "",
   "trap_verdict": "n/a",
   "missing_case": "",
   "note": ""}
]

Every candidate letter shown for a question must appear in "candidates". For trap questions, "candidates" may be {} if
none of the shown cases is worth grading.
