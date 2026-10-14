"""Post-generation citation check (CLAUDE.md rule 3).

The model may only point at sources by chunk id, e.g. [bns-103]. Every id it uses must be in the
retrieved hits; anything else is dropped. The citation text shown to the user always comes from
chunk metadata (rule 2), never from the model's own wording.
"""
import re

ID_RE = re.compile(r"\[([a-z0-9_]+-[A-Za-z0-9\-]+)\]")


def verify_citations(answer: str, hits: list[dict]):
    """Returns (clean_answer, citations, dropped_ids). Unknown [ids] are removed from the answer."""
    known = {h["chunk"]["id"]: h["chunk"]["citation"] for h in hits}
    used, dropped = [], []

    def repl(m):
        cid = m.group(1)
        if cid in known:
            if cid not in used:
                used.append(cid)
            return f"[{known[cid]}]"
        dropped.append(cid)
        return ""

    clean = re.sub(r"\s{2,}", " ", ID_RE.sub(repl, answer)).strip()
    return clean, [known[c] for c in used], dropped
