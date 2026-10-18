#!/usr/bin/env python3
"""Re-embed only the Act chunks that changed, instead of all ~3,700 (a few minutes on CPU became seconds).

    CHAMBERS_DATA_DIR=. PYTHONPATH=.:tools python3 tools/update_act_embeddings.py --root . --also hinduadoptionsmaintenanceact_1956-3 indiancontractact_1872-23

Reads corpus/chunks/acts/*.jsonl in the same order retrieve.py and tools/eval_embeddings.py use, keeps the stored vector of every
chunk whose id is already in corpus/embeddings/bge-m3/ids.json, embeds the chunks whose id is new plus any listed in --also
(chunks whose text changed but id stayed), and writes docs.npy + ids.json (old copies saved as *.before-update). Chunks that
disappeared are dropped. Checks the result: row count = chunk count, unit-length rows, kept rows identical.
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np

from eval_embeddings import MODELS, doc_text, load_chunks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--also", nargs="*", default=[], help="chunk ids to re-embed even though the id already existed")
    ap.add_argument("--model", default="bge-m3")
    a = ap.parse_args()
    root = Path(a.root).resolve()
    d = root / "corpus" / "embeddings" / a.model
    chunks = load_chunks(root)
    ids = [c["id"] for c in chunks]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise SystemExit(f"{len(dup)} duplicate chunk ids (e.g. {dup[:3]}): a backup *.jsonl is probably in corpus/chunks/acts/; move it out first")
    old_ids = json.loads((d / "ids.json").read_text())
    old = np.load(d / "docs.npy")
    assert len(old_ids) == len(old), "stored ids and vectors disagree; do not update, re-embed everything"
    pos = {i: n for n, i in enumerate(old_ids)}
    also = set(a.also)
    redo = [n for n, i in enumerate(ids) if i not in pos or i in also]
    redo_set = set(redo)
    unknown = [i for i in a.also if i not in set(ids)]
    if unknown:
        raise SystemExit(f"--also ids not found in the chunks: {unknown}")
    print(f"{len(ids)} chunks now, {len(old_ids)} before; embedding {len(redo)}: {[ids[n] for n in redo]}")
    new = np.zeros((len(ids), old.shape[1]), dtype="float32")
    for n, i in enumerate(ids):
        if n not in redo_set:
            new[n] = old[pos[i]]
    if redo:
        from sentence_transformers import SentenceTransformer
        hf, qp, dp = MODELS[a.model]
        m = SentenceTransformer(hf, device="cpu")
        m.max_seq_length = 512
        texts = [dp + doc_text(chunks[n]) for n in redo]
        vecs = m.encode(texts, batch_size=8, normalize_embeddings=True, show_progress_bar=False)
        for n, v in zip(redo, np.asarray(vecs, dtype="float32")):
            new[n] = v
    norms = np.sqrt(np.einsum("ij,ij->i", new, new))
    assert np.allclose(norms, 1.0, atol=1e-3), "some vectors are not unit length"
    keep = [n for n in range(len(ids)) if n not in redo_set]
    assert all(np.array_equal(new[n], old[pos[ids[n]]]) for n in keep)
    for f in ("docs.npy", "ids.json"):
        shutil.copy2(d / f, d / (f + ".before-update"))
    np.save(d / "docs.npy", new)
    (d / "ids.json").write_text(json.dumps(ids))
    print(f"done: {new.shape}; kept {len(keep)} vectors unchanged; backups: docs.npy.before-update, ids.json.before-update")


if __name__ == "__main__":
    main()
