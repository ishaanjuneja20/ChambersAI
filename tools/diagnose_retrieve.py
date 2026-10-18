#!/usr/bin/env python3
"""Why does retrieve() give low similarities? Run from the data folder:
    CHAMBERS_DATA_DIR=. PYTHONPATH=.:tools python3 tools/diagnose_retrieve.py
Checks (1) a stored chunk vector vs the same text re-embedded, (2) the query on cpu vs the default device."""
import numpy as np
from sentence_transformers import SentenceTransformer
from backend.rag.retrieve import load_index
from eval_embeddings import doc_text

idx = load_index()
i = next(n for n, c in enumerate(idx.chunks) if c["id"] == "bns_2023-103")
text = doc_text(idx.chunks[i])
Q = "punishment for murder"
for dev in (None, "cpu"):
    m = SentenceTransformer("BAAI/bge-m3", device=dev)
    m.max_seq_length = 512
    d = m.encode([text], normalize_embeddings=True)[0].astype("float64")
    q = m.encode([Q], normalize_embeddings=True)[0].astype("float64")
    print(f"--- device={dev or 'auto'} ({m.device})")
    print("re-embedded BNS103 vs stored vector, cosine:", round(float(d @ idx.vectors[i]), 4), "(should be ~1.0)")
    sims = np.einsum("ij,j->i", idx.vectors, q)
    top = np.argsort(-sims)[:3]
    print("query norm", round(float(np.linalg.norm(q)), 4), "BNS103 sim", round(float(sims[i]), 4))
    print("top3:", [(idx.chunks[t]["citation"], round(float(sims[t]), 3)) for t in top])
    print("query vs re-embedded BNS103:", round(float(q @ d), 4))
