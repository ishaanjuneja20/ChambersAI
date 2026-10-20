#!/usr/bin/env python3
"""Small lookup tables for the judgment paragraph index, so the server never has to scan the 1.9 GB of chunk text.

Reads   corpus/judgments_index/chunks/year=YYYY.jsonl            (tools/build_judgment_chunks.py)
Writes  corpus/judgments_index/chunk_index/year=YYYY.npz
          byte_off    int64 (n_rows + 1)   byte offset of each chunk line, so one chunk can be read without a scan
          case_paths  unicode (n_cases)    judgments kept for this year, in file order
          case_start  int64 (n_cases)      first row of each case in the year's chunk file / vector file
          case_end    int64 (n_cases)      one past the last row

A case that appears in several year files (extract_judgments.py wrote ~5,000 cases twice) is kept in the first
year only, the same rule the card and chunk builders use, so cards and chunks always agree on which copy counts.
Takes about a minute for all years; finished years are skipped.

    python3 tools/build_judgment_offsets.py --root ~/Desktop/RAG\\ Datasets
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import numpy as np

_PATH = re.compile(rb'"path": "([^"]*)"')


def index_year(chunk_file: str, seen: set):
    """Returns (byte_off, case_paths, case_start, case_end). `seen` holds cases kept in earlier years and is
    updated with the cases kept here. Rows of a case already kept in an earlier year are left out of the ranges."""
    offs, paths, starts, ends = [0], [], [], []
    block_path, block_start, row, pos = None, 0, 0, 0
    here = set()

    def close(end_row):
        if block_path is not None and block_path not in seen:
            paths.append(block_path)
            starts.append(block_start)
            ends.append(end_row)
            here.add(block_path)

    with open(chunk_file, "rb") as f:
        for line in f:
            pos += len(line)
            offs.append(pos)
            m = _PATH.search(line)
            p = m.group(1).decode("utf-8") if m else json.loads(line)["path"]
            if p != block_path:
                close(row)
                if p in here:
                    raise ValueError(f"{chunk_file}: case {p} appears in two separate blocks; chunks must be grouped by case")
                block_path, block_start = p, row
            row += 1
    close(row)
    seen.update(here)
    return offs, paths, starts, ends


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--index-dir", default=None, help="default: <root>/corpus/judgments_index")
    ap.add_argument("--years", default="1950-2026")
    ap.add_argument("--force", action="store_true", help="rebuild finished years")
    a = ap.parse_args()

    base = Path(a.index_dir) if a.index_dir else Path(a.root).resolve() / "corpus" / "judgments_index"
    out = base / "chunk_index"
    out.mkdir(parents=True, exist_ok=True)
    lo, _, hi = a.years.partition("-")
    seen: set = set()
    t0, kept = time.time(), 0
    for y in range(int(lo), int(hi or lo) + 1):
        src = base / "chunks" / f"year={y}.jsonl"
        dst = out / f"year={y}.npz"
        if not src.exists():
            continue
        if dst.exists() and not a.force:
            z = np.load(dst)
            seen.update(z["case_paths"].tolist())
            kept += len(z["case_paths"])
            print(f"{y}: done, skipping", flush=True)
            continue
        offs, paths, starts, ends = index_year(str(src), seen)
        tmp = dst.with_suffix(".tmp.npz")
        np.savez(tmp, byte_off=np.asarray(offs, dtype="int64"), case_paths=np.asarray(paths, dtype="U"),
                 case_start=np.asarray(starts, dtype="int64"), case_end=np.asarray(ends, dtype="int64"))
        tmp.replace(dst)
        kept += len(paths)
        print(f"{y}: {len(offs) - 1:>6,} rows, {len(paths):>5,} cases kept, {time.time() - t0:5.0f}s", flush=True)
    print(f"finished: {kept:,} cases -> {out}")


if __name__ == "__main__":
    main()
