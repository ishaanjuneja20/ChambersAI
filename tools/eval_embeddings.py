#!/usr/bin/env python3
"""Compare retrieval models on the draft test set (tests/eval/questions.json).

Run from the data folder (~/Desktop/RAG Datasets) with the repo's tests/ and tools/ copied or linked there:
    pip install numpy scikit-learn sentence-transformers
    python3 tools/eval_embeddings.py --root . --models tfidf e5-small
    python3 tools/eval_embeddings.py --root . --models e5-base bge-m3
    GEMINI_API_KEY=... python3 tools/eval_embeddings.py --root . --models gemini

Models
    tfidf      character n-gram TF-IDF. A lexical baseline: it should fail on Hindi, which shows the test is meaningful.
    e5-small   intfloat/multilingual-e5-small   (fast, ~470 MB download)
    e5-base    intfloat/multilingual-e5-base    (~1.1 GB)
    bge-m3     BAAI/bge-m3                       (~2.3 GB, slowest, usually the best multilingual)
    gemini     gemini-embedding-001 over REST   (needs GEMINI_API_KEY; untested here, check the first run)

Document embeddings are cached in corpus/embeddings/<model>/ and written in batches, so an interrupted run
resumes where it stopped. Results go to corpus/eval/<model>.json and corpus/eval/summary.md.
"""
import argparse, glob, json, os, sys, time
from pathlib import Path

import numpy as np

MODELS = {
    "e5-small": ("intfloat/multilingual-e5-small", "query: ", "passage: "),
    "e5-base": ("intfloat/multilingual-e5-base", "query: ", "passage: "),
    "bge-m3": ("BAAI/bge-m3", "", ""),
}
BATCH = 64
BOOSTS = [0.0, 0.02, 0.05, 0.1]
KS = [1, 3, 5, 10]


def load_chunks(root):
    chunks = []
    for f in sorted(glob.glob(str(root / "corpus" / "chunks" / "acts" / "*.jsonl"))):
        for line in open(f, encoding="utf-8"):
            c = json.loads(line)
            if c["kind"] == "act_schedule":
                continue
            chunks.append(c)
    return chunks


def doc_text(c):
    m = c["meta"]
    return f'{m["act"]}, {c["citation"]} - {m["title"]}. {c["text"]}'[:2500]


def key_of(c):
    return f'{c["meta"]["act_short"]}:{c["meta"]["section"]}'


# ---------------------------------------------------------------- embedders
class TfidfEmbedder:
    name = "tfidf"

    def __init__(self, docs):
        from sklearn.feature_extraction.text import TfidfVectorizer
        self.v = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2)
        self.docs = self.v.fit_transform(docs)

    def doc_matrix(self):
        return self.docs          # sparse, L2-normalised

    def query(self, qs):
        return self.v.transform(qs)

    @staticmethod
    def sims(Q, D):
        return (Q @ D.T).toarray()


class DenseEmbedder:
    def __init__(self, short, root, chunks, device=None, batch_size=16):
        from sentence_transformers import SentenceTransformer
        self.short = short
        self.batch_size = batch_size
        hf, self.qp, self.dp = MODELS[short]
        print(f"loading {hf} (device={device or 'auto'}, batch={batch_size}) ...", flush=True)
        self.m = SentenceTransformer(hf, device=device)
        self.m.max_seq_length = 512
        self.dir = root / "corpus" / "embeddings" / short
        self.chunks = chunks

    def encode(self, texts):
        out = self.m.encode(texts, batch_size=self.batch_size, normalize_embeddings=True, show_progress_bar=False)
        try:                                   # keep Apple-GPU memory from piling up between batches
            import torch
            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
        except Exception:
            pass
        return out

    def doc_matrix(self):
        return cached_docs(self.dir, self.chunks, lambda t: self.encode([self.dp + x for x in t]))

    def query(self, qs):
        return self.encode([self.qp + q for q in qs])

    @staticmethod
    def sims(Q, D):
        return np.asarray(Q, dtype="float64") @ np.asarray(D, dtype="float64").T


class GeminiEmbedder:
    def __init__(self, root, chunks):
        import urllib.request  # noqa
        self.key = os.environ.get("GEMINI_API_KEY")
        if not self.key:
            sys.exit("Set GEMINI_API_KEY to evaluate gemini")
        self.dir = root / "corpus" / "embeddings" / "gemini"
        self.chunks = chunks

    def _call(self, texts, task):
        import urllib.request
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key={self.key}"
        body = {"requests": [{"model": "models/gemini-embedding-001", "taskType": task,
                              "outputDimensionality": 768, "content": {"parts": [{"text": t[:8000]}]}} for t in texts]}
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    out = json.load(r)
                v = np.array([e["values"] for e in out["embeddings"]], dtype="float32")
                return v / np.linalg.norm(v, axis=1, keepdims=True)
            except Exception as e:                       # rate limits etc.
                wait = 10 * (attempt + 1)
                print(f"  gemini error ({e}); retry in {wait}s", flush=True)
                time.sleep(wait)
        sys.exit("gemini kept failing")

    def doc_matrix(self):
        return cached_docs(self.dir, self.chunks, lambda t: self._call(t, "RETRIEVAL_DOCUMENT"), batch=50)

    def query(self, qs):
        return np.vstack([self._call(qs[i:i + 50], "RETRIEVAL_QUERY") for i in range(0, len(qs), 50)])

    @staticmethod
    def sims(Q, D):
        return np.asarray(Q, dtype="float64") @ np.asarray(D, dtype="float64").T


def cached_docs(dir_, chunks, encode, batch=BATCH):
    """Embed all chunk texts, saving partial progress so an interrupted run resumes."""
    dir_.mkdir(parents=True, exist_ok=True)
    final, part = dir_ / "docs.npy", dir_ / "docs.partial.npy"
    ids = [c["id"] for c in chunks]
    idf = dir_ / "ids.json"
    if final.exists() and idf.exists() and json.loads(idf.read_text()) == ids:
        return np.load(final)
    done = np.load(part) if part.exists() and (dir_ / "ids.partial.json").exists() \
        and json.loads((dir_ / "ids.partial.json").read_text()) == ids else np.zeros((0, 0), dtype="float32")
    texts = [doc_text(c) for c in chunks]
    rows = [done] if len(done) else []
    start = len(done)
    t0 = time.time()
    for i in range(start, len(texts), batch):
        rows.append(np.asarray(encode(texts[i:i + batch]), dtype="float32"))
        if (i // batch) % 8 == 0:
            m = np.vstack(rows)
            np.save(part, m)
            (dir_ / "ids.partial.json").write_text(json.dumps(ids))
            rate = (i + batch - start) / max(1, time.time() - t0)
            print(f"  embedded {min(i + batch, len(texts))}/{len(texts)}  ({rate:.1f}/s)", flush=True)
    m = np.vstack(rows)
    np.save(final, m)
    idf.write_text(json.dumps(ids))
    for p in (part, dir_ / "ids.partial.json"):
        if p.exists():
            p.unlink()
    return m


# ---------------------------------------------------------------- query rewriting (optional)
REWRITE_PROMPT = (
    "You help search a database of Indian statutes (BNS, BNSS, BSA, the Constitution, Hindu Marriage/Succession Acts, "
    "Consumer Protection Act, Contract Act, Transfer of Property Act, labour codes, RERA, RTI and similar).\n"
    "Rewrite the user's question as ONE short English search query that uses the legal terms a statute would use "
    "(for example 'specific performance of contract', 'anticipatory bail', 'retrenchment compensation'). "
    "If the question is in Hindi, translate it. Do NOT answer the question and do NOT cite section numbers. "
    "Output only the query.\n\nQuestion: ")


def rewrite_queries(questions, root, model):
    import urllib.request
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("Set GEMINI_API_KEY to use --rewrite")
    path = root / "corpus" / "eval" / f"rewrites_{model}.json"
    cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    for q in questions:
        if q["id"] in cache:
            continue
        body = {"contents": [{"parts": [{"text": REWRITE_PROMPT + q["question"]}]}],
                "generationConfig": {"temperature": 0}}
        for attempt in range(6):
            try:
                req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    out = json.load(r)
                cache[q["id"]] = out["candidates"][0]["content"]["parts"][0]["text"].strip()
                break
            except Exception as e:
                wait = 8 * (attempt + 1)
                print(f"  rewrite error for {q['id']} ({e}); retry in {wait}s", flush=True)
                time.sleep(wait)
        else:
            sys.exit("rewrite kept failing; check GEMINI_API_KEY and --rewrite-model")
        path.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(0.5)
    return [cache[q["id"]] for q in questions]


# ---------------------------------------------------------------- evaluation
def evaluate(sims, chunks, questions):
    keys = [key_of(c) for c in chunks]
    doms = [set(c["domains"]) for c in chunks]
    uniq = sorted(set(keys))
    kidx = {k: i for i, k in enumerate(uniq)}
    chunk_to_key = np.array([kidx[k] for k in keys])
    key_domains = [set() for _ in uniq]
    for ci, k in enumerate(chunk_to_key):
        key_domains[k] |= doms[ci]

    # best chunk score per section (sections can have several part chunks)
    S = np.full((len(questions), len(uniq)), -1.0, dtype="float32")
    for ci, k in enumerate(chunk_to_key):
        S[:, k] = np.maximum(S[:, k], sims[:, ci])

    res = {"boost": {}, "misses": [], "refusal": {}}
    for b in BOOSTS:
        hits = {lang: {k: [] for k in KS} for lang in ("en", "hi")}
        rr = {"en": [], "hi": []}
        per_domain = {}
        for qi, q in enumerate(questions):
            if q["type"] != "answerable":
                continue
            sc = S[qi].copy()
            if b:
                sc += b * np.array([q["lawyer"] in d for d in key_domains], dtype="float32")
            order = np.argsort(-sc)
            ranked = [uniq[i] for i in order[:50]]
            rank = next((r + 1 for r, k in enumerate(ranked) if k in q["gold"]), None)
            for k_ in KS:
                hits[q["lang"]][k_].append(1 if rank and rank <= k_ else 0)
            rr[q["lang"]].append(1 / rank if rank else 0)
            per_domain.setdefault((q["lawyer"], q["lang"]), []).append(1 if rank and rank <= 5 else 0)
            if b == 0 and (rank is None or rank > 5):
                res["misses"].append({"id": q["id"], "question": q["question"], "gold": q["gold"], "rank": rank,
                                      "top3": ranked[:3]})
        res["boost"][str(b)] = {
            lang: {**{f"hit@{k}": round(float(np.mean(hits[lang][k])), 3) for k in KS},
                   "mrr": round(float(np.mean(rr[lang])), 3), "n": len(rr[lang])} for lang in ("en", "hi")}
        if b == 0:
            res["per_domain_hit@5"] = {f"{d}/{l}": round(float(np.mean(v)), 2) for (d, l), v in sorted(per_domain.items())}

    # refusal threshold: top-1 section score for answerable vs trap questions
    top1 = S.max(axis=1)
    for lang in ("en", "hi"):
        a = np.array([top1[i] for i, q in enumerate(questions) if q["lang"] == lang and q["type"] == "answerable"])
        t = np.array([top1[i] for i, q in enumerate(questions) if q["lang"] == lang and q["type"] == "trap"])
        grid = np.unique(np.round(np.concatenate([a, t]), 3))
        best = max(grid, key=lambda th: ((a >= th).mean() + (t < th).mean()) / 2)
        res["refusal"][lang] = {
            "answerable_top1_mean": round(float(a.mean()), 3), "trap_top1_mean": round(float(t.mean()), 3),
            "best_threshold": float(best), "answerable_kept": round(float((a >= best).mean()), 2),
            "traps_refused": round(float((t < best).mean()), 2)}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--models", nargs="+", default=["tfidf"])
    ap.add_argument("--questions", default=None)
    ap.add_argument("--device", default=None, help="cpu, mps or cuda (default: automatic). Use cpu if the GPU runs out of memory")
    ap.add_argument("--batch-size", type=int, default=16, help="lower it (e.g. 4) if memory runs out")
    ap.add_argument("--rewrite", action="store_true", help="rewrite each question into an English legal search query with Gemini first")
    ap.add_argument("--rewrite-model", default="gemini-2.5-flash")
    a = ap.parse_args()
    root = Path(a.root).resolve()
    qpath = Path(a.questions) if a.questions else (root / "tests" / "eval" / "questions.json")
    questions = json.loads(qpath.read_text(encoding="utf-8"))
    chunks = load_chunks(root)
    print(f"{len(chunks)} chunks, {len(questions)} questions")
    out_dir = root / "corpus" / "eval"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in a.models:
        t0 = time.time()
        if name == "tfidf":
            emb = TfidfEmbedder([doc_text(c) for c in chunks])
        elif name == "gemini":
            emb = GeminiEmbedder(root, chunks)
        elif name in MODELS:
            emb = DenseEmbedder(name, root, chunks, device=a.device, batch_size=a.batch_size)
        else:
            sys.exit(f"unknown model {name}")
        D = emb.doc_matrix()
        qtexts = [q["question"] for q in questions]
        label = name
        if a.rewrite:
            qtexts = rewrite_queries(questions, root, a.rewrite_model)
            label = f"{name}+rewrite"
        Q = emb.query(qtexts)
        res = evaluate(emb.sims(Q, D), chunks, questions)
        res["model"] = label
        res["seconds"] = round(time.time() - t0)
        (out_dir / f"{label}.json").write_text(json.dumps(res, indent=1, ensure_ascii=False))
        print(f"\n== {label} ({res['seconds']}s)")
        for b, r in res["boost"].items():
            print(f"  boost {b}: EN {r['en']}  HI {r['hi']}")
        print("  refusal:", res["refusal"])
    # summary table across every model that has a result file
    rows = []
    for p in sorted(out_dir.glob("*.json")):
        r = json.loads(p.read_text())
        b0 = r["boost"]["0.0"]
        rows.append(f"| {r['model']} | {b0['en']['hit@1']} | {b0['en']['hit@5']} | {b0['hi']['hit@1']} | {b0['hi']['hit@5']} | "
                    f"{r['refusal']['en']['traps_refused']} / {r['refusal']['en']['answerable_kept']} | "
                    f"{r['refusal']['hi']['traps_refused']} / {r['refusal']['hi']['answerable_kept']} |")
    (out_dir / "summary.md").write_text(
        "| model | EN hit@1 | EN hit@5 | HI hit@1 | HI hit@5 | EN traps refused / answerable kept | HI traps refused / answerable kept |\n"
        "|---|---|---|---|---|---|---|\n" + "\n".join(rows) + "\n")
    print("\n" + (out_dir / "summary.md").read_text())


if __name__ == "__main__":
    main()
