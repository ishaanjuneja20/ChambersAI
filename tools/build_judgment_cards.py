#!/usr/bin/env python3
"""Stage 1 of judgment retrieval: one "case card" per Supreme Court judgment, embedded with bge-m3.

A card is the case name + citation + the opening of the judgment (for reported cases this is the headnote,
which says what the case is about). Retrieval finds the right *cases* with the cards; the paragraphs of the top
cases are searched afterwards (stage 2, not in this script). See DECISIONS.md.

Reads   corpus/judgments/year=YYYY.jsonl.gz      (made by extract_judgments.py)
        judgments_metadata_all.csv               (case name, citation, date, court)
        judgment_domains.csv                     (domain tags, used only as a soft ranking boost later)
Writes  corpus/judgments_index/cards/year=YYYY.jsonl
        corpus/judgments_index/embeddings/bge-m3/year=YYYY.npy   (float32, L2-normalised, same row order)

Every card's citation fields come from the metadata CSV, never from text we generate. Finished years are
skipped, so you can stop (Ctrl+C) and re-run.

Run from ~/Desktop/RAG Datasets:
    python3 tools/build_judgment_cards.py --root . --years 2019 --no-embed --out-dir /tmp/cards_test   # quick check
    python3 tools/build_judgment_cards.py --root .                                                       # everything (~1 h)
Needs: pip install numpy sentence-transformers
"""
from __future__ import annotations

import argparse
import csv
import glob
import gzip
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

CARD_CHARS = 1600
MODEL = "BAAI/bge-m3"

_MARGIN = re.compile(r"(?m)^[ \t]*[A-H][ \t]*$")  # single-letter margin labels in SCR pages
_RUNNING = re.compile(r"(?mi)^[ \t]*(\[\s*\d{4}\s*\][ \t]*\d*[ \t]*)?(S\.?\s?C\.?\s?R\.?[ \t]*\d*|SUPREME COURT REPORTS|\d{1,4})[ \t]*$")
# The bench line ends "...JJ.]" / "...J.]" / "...CJ.]"; OCR often turns the "]" into "J" or ")".
_BENCH = re.compile(r"\b(?:C\.?\s?J|J{1,2})\.?\s*[\]J\)]")


def clean(text: str) -> str:
    t = text.replace("\f", "\n")
    t = _MARGIN.sub("", t)
    t = _RUNNING.sub("", t)
    return re.sub(r"\s+", " ", t).strip()


def card_text(title: str, citation: str, year: object, text: str, chars: int = CARD_CHARS) -> tuple:
    """Returns (card, found_bench_line). Without a bench line the card falls back to the start of the text."""
    t = clean(text)
    m = _BENCH.search(t[:6000])
    body = t[m.end():] if m else t
    head = " | ".join(x for x in (title.strip(), citation.strip(), str(year)) if x)
    return f"{head}\n{body.strip()[:chars]}", bool(m)


def load_meta(root: Path) -> Dict[str, dict]:
    csv.field_size_limit(sys.maxsize)
    keep = ("title", "petitioner", "respondent", "citation", "case_id", "decision_date", "court", "year")
    meta: Dict[str, dict] = {}
    with open(root / "judgments_metadata_all.csv", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            meta[row["path"]] = {k: (row.get(k) or "").strip() for k in keep}
    return meta


def load_domains(root: Path) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    p = root / "judgment_domains.csv"
    if p.exists():
        with open(p, encoding="utf-8", newline="") as f:
            for row in csv.DictReader(f):
                out[row["path"]] = [d for d in re.split(r"[,|;]\s*", row.get("domains", "")) if d]
    return out


def case_title(m: dict, path: str) -> str:
    t = re.sub(r"\s+", " ", m.get("title", "")).strip()
    if t:
        return t
    a, b = m.get("petitioner", ""), m.get("respondent", "")
    return f"{a} versus {b}".strip() if a and b else path


def build_year(path: str, meta: Dict[str, dict], doms: Dict[str, List[str]], limit: Optional[int]) -> List[dict]:
    cards, seen = [], set()
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            p = r["path"]
            if p in seen:  # extract_judgments.py wrote ~5,000 cases twice; keep the first copy
                continue
            seen.add(p)
            m = meta.get(p, {})
            title = case_title(m, p)
            citation = m.get("citation", "")
            card, found = card_text(title, citation, r["year"], r.get("text", ""))
            cards.append({
                "id": "sc-" + p,
                "path": p,
                "title": title,
                "citation": citation,
                "case_id": m.get("case_id", ""),
                "decision_date": m.get("decision_date", ""),
                "court": m.get("court") or "Supreme Court of India",
                "year": r["year"],
                "domains": doms.get(p, []),
                "card": card,
                "bench_found": found,
            })
            if limit and len(cards) >= limit:
                break
    return cards


class Embedder:
    def __init__(self, device: str, batch_size: int):
        from sentence_transformers import SentenceTransformer
        if device == "auto":
            import torch
            device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.m = SentenceTransformer(MODEL, device=device)
        self.m.max_seq_length = 512
        self.bs = batch_size
        print(f"model {MODEL} on {device}, batch {self.bs}", flush=True)

    def __call__(self, texts: List[str]):
        import numpy as np
        return np.asarray(self.m.encode(texts, batch_size=self.bs, normalize_embeddings=True,
                                        show_progress_bar=False), dtype="float32")


def atomic_write(path: Path, write):
    tmp = path.with_suffix(path.suffix + ".tmp")
    write(tmp)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--years", default="1950-2026", help="e.g. 2019 or 2015-2026")
    ap.add_argument("--out-dir", default=None, help="default: <root>/corpus/judgments_index")
    ap.add_argument("--no-embed", action="store_true", help="write cards only (quick check, no model needed)")
    ap.add_argument("--device", default="auto", help="auto | mps | cpu (documents are fine on mps)")
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--limit", type=int, default=None, help="cards per year, for testing")
    a = ap.parse_args()

    root = Path(a.root).resolve()
    out = Path(a.out_dir) if a.out_dir else root / "corpus" / "judgments_index"
    lo, _, hi = a.years.partition("-")
    years = range(int(lo), int(hi or lo) + 1)
    cdir, edir = out / "cards", out / "embeddings" / "bge-m3"
    cdir.mkdir(parents=True, exist_ok=True)
    edir.mkdir(parents=True, exist_ok=True)

    meta, doms = load_meta(root), load_domains(root)
    print(f"metadata rows {len(meta):,}, domain rows {len(doms):,}", flush=True)
    emb = None if a.no_embed else Embedder(a.device, a.batch_size)

    t0, done_cards = time.time(), 0
    for y in years:
        src = root / "corpus" / "judgments" / f"year={y}.jsonl.gz"
        cf, ef = cdir / f"year={y}.jsonl", edir / f"year={y}.npy"
        if not src.exists():
            continue
        if cf.exists() and (a.no_embed or ef.exists()):
            print(f"{y}: done, skipping", flush=True)
            continue
        cards = build_year(str(src), meta, doms, a.limit)
        missing = sum(1 for c in cards if not c["citation"] and not c["case_id"])
        if not cards:
            continue
        if emb is not None:
            import numpy as np
            vecs = emb([c["card"] for c in cards])
            assert vecs.shape == (len(cards), 1024), vecs.shape
            atomic_write(ef, lambda p: np.save(open(p, "wb"), vecs))
        atomic_write(cf, lambda p: p.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in cards) + "\n", encoding="utf-8"))
        done_cards += len(cards)
        nb = sum(1 for c in cards if c["bench_found"])
        print(f"{y}: {len(cards):>5} cards, {nb} start after the bench line, {missing} without citation metadata, "
              f"{time.time() - t0:6.0f}s elapsed", flush=True)
    print(f"finished: {done_cards:,} new cards in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
