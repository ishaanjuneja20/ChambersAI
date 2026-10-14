#!/usr/bin/env python3
"""Add 'formerly IPC/CrPC' information to the BNS and BNSS chunks (idempotent; safe to rerun).

Needs corpus/citation_map.json (tools/build_citation_map.py) and corpus/chunks/acts/*.jsonl
(tools/chunk_acts.py). For each chunk it sets:
    meta.formerly       = list of old section numbers (e.g. ["302"])
    meta.formerly_act   = "IPC" or "CrPC"
    meta.is_new         = True when the table says the provision has no old equivalent
    citation            = "BNS s.103 (formerly IPC s.302)"   (only when 1-4 old sections)
Usage (from the data folder):  python3 tools/apply_citation_map.py --root .
"""
import argparse, json, os
from pathlib import Path

ACTS = {"BNS_2023": "bns", "BNSS_2023": "bnss"}
MAX_LABEL = 4


def label(old_act, toks):
    if len(toks) == 1:
        return f" (formerly {old_act} s.{toks[0]})"
    return f" (formerly {old_act} ss.{', '.join(toks)})"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    a = ap.parse_args()
    root = Path(a.root)
    cmap = json.loads((root / "corpus" / "citation_map.json").read_text())
    for act, key in ACTS.items():
        path = root / "corpus" / "chunks" / "acts" / f"{act}.jsonl"
        if not path.exists():
            print(f"skip {act}: no chunk file")
            continue
        sections = cmap[key]["sections"]
        old_act = cmap[key]["old_act"]
        out, stats = [], {"labelled": 0, "new": 0, "no_entry": 0, "many": 0}
        for line in open(path, encoding="utf-8"):
            c = json.loads(line)
            if c["kind"] == "act_section":
                base = c["citation"].split(" (formerly")[0].split(" (new")[0]
                entry = sections.get(c["meta"]["section"])
                c["citation"] = base
                if entry is None:
                    stats["no_entry"] += 1
                elif entry["old"]:
                    c["meta"]["formerly"] = entry["old"]
                    c["meta"]["formerly_act"] = old_act
                    c["meta"]["is_new"] = False
                    if len(entry["old"]) <= MAX_LABEL:
                        c["citation"] = base + label(old_act, entry["old"])
                        stats["labelled"] += 1
                    else:
                        stats["many"] += 1
                else:
                    c["meta"]["formerly"] = []
                    c["meta"]["formerly_act"] = old_act
                    c["meta"]["is_new"] = True
                    stats["new"] += 1
            out.append(json.dumps(c, ensure_ascii=False))
        tmp = path.with_suffix(".jsonl.tmp")
        tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
        os.replace(tmp, path)
        print(act, stats)


if __name__ == "__main__":
    main()
