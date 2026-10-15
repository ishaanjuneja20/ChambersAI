#!/usr/bin/env python3
"""Stage 2 of judgment retrieval: split every judgment into paragraph-sized chunks and embed them with bge-m3.

Reads   corpus/judgments/year=YYYY.jsonl.gz          (full text, from extract_judgments.py)
        judgments_metadata_all.csv                   (case name, citation, date, court)
        judgment_domains.csv                         (domain tags: soft boost only)
Writes  corpus/judgments_index/chunks/year=YYYY.jsonl
        corpus/judgments_index/chunk_embeddings/bge-m3/year=YYYY.npy   (float16, L2-normalised, same row order)

Each chunk record: {id, case_id, path, title, citation, year, court, decision_date, domains, para, text}
 - "para" is the judgment's own paragraph number when the chunk starts at a numbered paragraph ("12. ..."), else null.
 - All citation fields come from the metadata CSV or the judgment text itself; nothing is generated.

Chunking: wrapped lines are joined into paragraphs, page furniture (margin letters, running headers, bare page
numbers) is dropped, then consecutive paragraphs are packed up to --max-chars (default 1400, about 350 tokens).
A paragraph longer than that is split at sentence ends.

Finished years are skipped; stop with Ctrl+C and re-run to resume.

    python3 tools/build_judgment_chunks.py --root . --count-only --years 2019         # chunk count, no model
    python3 tools/build_judgment_chunks.py --root .                                    # everything (many hours)
Needs: pip install numpy sentence-transformers
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_judgment_cards import (_MARGIN, _RUNNING, Embedder, atomic_write, case_title,  # noqa: E402
                                  load_domains, load_meta)

MAX_CHARS = 1400
MIN_CHARS = 250
_PARA_NO = re.compile(r"^\s*(\d{1,3})\s*[\.\)]\s+\S")
_SENT = re.compile(r"(?<=[\.\?\!;])\s+(?=[A-Z\(\"'])")


def paragraphs(text: str) -> List[str]:
    """Join hard-wrapped lines into paragraphs; drop page furniture."""
    t = text.replace("\f", "\n\n")
    t = _MARGIN.sub("", t)
    t = _RUNNING.sub("", t)
    out = []
    for block in re.split(r"\n\s*\n", t):
        p = re.sub(r"\s+", " ", block).strip()
        if len(p) >= 3:
            out.append(p)
    return out


def split_long(p: str, max_chars: int) -> List[str]:
    if len(p) <= max_chars:
        return [p]
    parts, cur = [], ""
    for s in _SENT.split(p):
        while len(s) > max_chars:  # no sentence end in sight: hard split on a space
            cut = s.rfind(" ", 0, max_chars)
            cut = cut if cut > max_chars // 2 else max_chars
            if cur:
                parts.append(cur)
                cur = ""
            parts.append(s[:cut].strip())
            s = s[cut:].strip()
        if cur and len(cur) + 1 + len(s) > max_chars:
            parts.append(cur)
            cur = s
        else:
            cur = f"{cur} {s}".strip()
    if cur:
        parts.append(cur)
    return parts


def chunk_text(text: str, max_chars: int = MAX_CHARS, min_chars: int = MIN_CHARS) -> List[Tuple[Optional[int], str]]:
    """Returns [(first_paragraph_number_or_None, chunk_text)]."""
    units: List[Tuple[Optional[int], str]] = []
    for p in paragraphs(text):
        m = _PARA_NO.match(p)
        no = int(m.group(1)) if m else None
        for i, piece in enumerate(split_long(p, max_chars)):
            units.append((no if i == 0 else None, piece))
    chunks: List[Tuple[Optional[int], str]] = []
    cur_no, cur = None, ""
    for no, u in units:
        if cur and len(cur) + 1 + len(u) > max_chars:
            chunks.append((cur_no, cur))
            cur_no, cur = None, ""
        if not cur:
            cur_no = no
        cur = f"{cur} {u}".strip()
    if cur:
        if chunks and len(cur) < min_chars:  # fold a tiny tail into the previous chunk
            pn, pt = chunks[-1]
            chunks[-1] = (pn, f"{pt} {cur}")
        else:
            chunks.append((cur_no, cur))
    return chunks


def year_chunks(path: str, meta, doms, seen: Optional[set] = None) -> Iterator[dict]:
    """`seen` is shared across years so a case that appears in two year files is kept once (first year wins)."""
    seen = set() if seen is None else seen
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            p = r["path"]
            if p in seen:  # extract_judgments.py wrote ~5,000 cases twice, across year files; keep the first copy
                continue
            seen.add(p)
            m = meta.get(p, {})
            base = {
                "case_id": "sc-" + p,
                "path": p,
                "title": case_title(m, p),
                "citation": m.get("citation", ""),
                "year": r["year"],
                "court": m.get("court") or "Supreme Court of India",
                "decision_date": m.get("decision_date", ""),
                "domains": doms.get(p, []),
            }
            for i, (no, txt) in enumerate(chunk_text(r.get("text", ""))):
                yield dict(base, id=f"sc-{p}#{i}", para=no, text=txt)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--years", default="1950-2026")
    ap.add_argument("--out-dir", default=None, help="default: <root>/corpus/judgments_index")
    ap.add_argument("--count-only", action="store_true", help="count chunks per year and exit (no files, no model)")
    ap.add_argument("--no-embed", action="store_true", help="write chunk files only")
    ap.add_argument("--device", default="auto", help="auto | cuda | mps | cpu")
    ap.add_argument("--batch-size", type=int, default=None, help="default 64 on cuda, 16 otherwise")
    ap.add_argument("--embed-chunk", type=int, default=2048, help="chunks embedded between progress lines")
    a = ap.parse_args()

    root = Path(a.root).resolve()
    out = Path(a.out_dir) if a.out_dir else root / "corpus" / "judgments_index"
    lo, _, hi = a.years.partition("-")
    years = range(int(lo), int(hi or lo) + 1)
    cdir, edir = out / "chunks", out / "chunk_embeddings" / "bge-m3"
    meta, doms = load_meta(root), load_domains(root)
    print(f"metadata rows {len(meta):,}", flush=True)

    seen: set = set()
    if a.count_only:
        tot = 0
        for y in years:
            src = root / "corpus" / "judgments" / f"year={y}.jsonl.gz"
            if src.exists():
                n = sum(1 for _ in year_chunks(str(src), meta, doms, seen))
                tot += n
                print(f"{y}: {n:,} chunks", flush=True)
        print(f"total {tot:,} chunks")
        return

    cdir.mkdir(parents=True, exist_ok=True)
    edir.mkdir(parents=True, exist_ok=True)
    emb = None if a.no_embed else Embedder(a.device, a.batch_size)
    import numpy as np

    t0, total = time.time(), 0
    for y in years:
        src = root / "corpus" / "judgments" / f"year={y}.jsonl.gz"
        cf, ef = cdir / f"year={y}.jsonl", edir / f"year={y}.npy"
        if not src.exists():
            continue
        if cf.exists() and (a.no_embed or ef.exists()):
            seed = out / "cards" / f"year={y}.jsonl"  # cards hold exactly the cases kept for that year
            seed = seed if seed.exists() else cf
            seen.update(json.loads(l).get("path") for l in open(seed, encoding="utf-8") if l.strip())
            print(f"{y}: done, skipping", flush=True)
            continue
        chunks = list(year_chunks(str(src), meta, doms, seen))
        if not chunks:
            continue
        if emb is not None:
            parts = []
            for i in range(0, len(chunks), a.embed_chunk):
                part = chunks[i:i + a.embed_chunk]
                parts.append(emb([f'{c["title"]}\n{c["text"]}' for c in part]).astype("float16"))
                print(f"  {y}: {min(i + a.embed_chunk, len(chunks)):,}/{len(chunks):,}  {time.time() - t0:7.0f}s", flush=True)
            vecs = np.concatenate(parts)
            assert vecs.shape == (len(chunks), 1024), vecs.shape
            atomic_write(ef, lambda p: np.save(open(p, "wb"), vecs))
        atomic_write(cf, lambda p: p.write_text("\n".join(json.dumps(c, ensure_ascii=False) for c in chunks) + "\n", encoding="utf-8"))
        total += len(chunks)
        print(f"{y}: {len(chunks):>6,} chunks written, {total:,} total, {time.time() - t0:7.0f}s elapsed", flush=True)
    print(f"finished: {total:,} new chunks in {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
