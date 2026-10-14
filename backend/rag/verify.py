"""Post-generation citation check (CLAUDE.md rule 3).

The model may only point at sources by chunk id, e.g. [bns_2023-103] or grouped [a-1, b-2]. Every id it uses
must be in the retrieved hits; anything else is dropped. The citation text shown to the user always comes
from chunk metadata (rule 2), never from the model's own wording.
"""
from __future__ import annotations

import re

GROUP_RE = re.compile(r"\[([^\[\]]{1,400})\]")
ID_LIKE = re.compile(r"[a-z0-9_]+-[A-Za-z0-9\-]+")
SPLIT = re.compile(r"\s*[,;،]\s*")


def verify_citations(answer: str, hits: list[dict]):
    """Returns (clean_answer, citations, dropped_ids). Known ids become their metadata citation;
    unknown ids are removed so no internal id or invented source reaches the reader."""
    known = {h["chunk"]["id"]: h["chunk"]["citation"] for h in hits}
    used, dropped = [], []

    def repl(m):
        parts = [p for p in SPLIT.split(m.group(1).strip()) if p]
        if not parts or not all(ID_LIKE.fullmatch(p) for p in parts):
            return m.group(0)                      # ordinary bracketed text, leave alone
        good = []
        for p in parts:
            if p in known:
                if known[p] not in good:
                    good.append(known[p])
                if p not in used:
                    used.append(p)
            else:
                dropped.append(p)
        return "[" + "; ".join(good) + "]" if good else ""

    clean = GROUP_RE.sub(repl, answer)
    clean = re.sub(r"[ \t]{2,}", " ", clean).strip()
    return clean, [known[c] for c in used], dropped
