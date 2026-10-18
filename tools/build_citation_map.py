#!/usr/bin/env python3
"""Build BNS<->IPC and BNSS<->CrPC correspondence maps from the two comparison PDFs.

Only the section NUMBERS are used. The PDFs' "summary of comparison" prose is not authored by the
statute and is not copied anywhere.

Usage (from the data folder):
    python3 tools/build_citation_map.py --root .
Needs: pip install pdfplumber
Writes corpus/citation_map.json and corpus/citation_map_review.csv (one row per table row).
"""
import argparse, csv, json, re
from pathlib import Path

import pdfplumber

SEC_RE = re.compile(r"^\d{1,3}[A-Z]{0,2}(\s*\(\s*\w+\s*\)\s*)*$")
OLD_TOKEN = re.compile(r"\d{1,3}(?:-?[A-Z]{1,2})?(?:\s*\(\s*\w+\s*\))*")
PAIRS = {
    "bns": ("comparison_BNS_to_IPC.pdf", "IPC"),
    "bnss": ("comparison_BNSS_to_CrPC.pdf", "CrPC"),
}


def clean(c):
    return re.sub(r"\s+", " ", (c or "").replace("\n", " ")).strip()


def top(sec):
    return re.match(r"\d{1,3}[A-Z]{0,2}", sec.replace(" ", "")).group(0)


def parse_old(cell):
    c = clean(cell)
    low = c.lower()
    if low in ("new", "-", "—", "", "nil", "omitted") or low.startswith("new"):
        return [], ("new" if low.startswith("new") or low in ("-", "—", "nil") else "blank")
    toks = [re.sub(r"[\s-]+", "", t) for t in OLD_TOKEN.findall(c)]
    return toks, "mapped" if toks else "unparsed"


TOP_LINE = re.compile(
    r"^(?P<new>\d{1,3}[A-Z]{0,2}(?:\s*\(\s*\w+\s*\))*)\s+(?P<subj>.+?)\s+"
    r"(?P<old>\d{1,3}(?:-?[A-Z]{1,2})?(?:\s*\(\s*\w+\s*\))*(?:\s*(?:,|&|and)\s*\d{1,3}(?:-?[A-Z]{1,2})?)*|New|-)\s+(?P<rest>\S.*)$")


def rows_above_table(page):
    """The first row(s) on a page sometimes sit above the detected table; read them from the text."""
    found = page.find_tables()
    top = found[0].bbox[1] if found else page.height
    if top < 20:
        return []
    text = page.crop((0, 0, page.width, top)).extract_text() or ""
    rows = []
    for ln in text.split("\n"):
        m = TOP_LINE.match(clean(ln))
        if m and SEC_RE.match(m.group("new")):
            rows.append({"new": m.group("new").replace(" ", ""), "subject": m.group("subj"),
                         "old_raw": m.group("old"), "from_text": True})
    return rows


def rows_from_pdf(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for pn, page in enumerate(pdf.pages, start=1):
            for r in rows_above_table(page):
                out.append({"page": pn, **r})
            for table in page.extract_tables():
                for r in table:
                    cells = [clean(x) for x in r]
                    # first non-empty cell must look like a section number
                    idx = next((i for i, x in enumerate(cells) if x), None)
                    if idx is None:
                        continue
                    sec = cells[idx]
                    if not SEC_RE.match(sec):
                        continue
                    rest = [x for x in cells[idx + 1:]]
                    # columns: subject, old sections, summary (empty spacer columns removed)
                    rest = [x for x in rest if x != ""] if len([x for x in rest if x]) >= 2 else rest
                    if len(rest) < 2:
                        continue
                    subject, old_cell = rest[0], rest[1]
                    out.append({"page": pn, "new": sec.replace(" ", ""), "subject": subject, "old_raw": old_cell})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    a = ap.parse_args()
    root = Path(a.root)
    result, review = {}, []
    for key, (fname, old_name) in PAIRS.items():
        rows = rows_from_pdf(root / "statutes" / "criminal" / fname)
        sections = {}
        for r in rows:
            toks, status = parse_old(r["old_raw"])
            r.update({"old": toks, "status": status, "act": key})
            review.append(r)
            s = sections.setdefault(top(r["new"]), {"old": [], "status": set(), "rows": 0, "whole_row": None})
            s["rows"] += 1
            if r["new"] == top(r["new"]):          # the row for the whole section, not a sub-section
                s["whole_row"] = {"old": toks, "status": status, "old_raw": r["old_raw"]}
            for t in toks:
                if t not in s["old"]:
                    s["old"].append(t)
            s["status"].add(status)
        for v in sections.values():
            v["status"] = sorted(v["status"])
        result[key] = {"old_act": old_name, "sections": sections}
        print(f"{key}: {len(rows)} rows, {len(sections)} distinct new sections")
    (root / "corpus").mkdir(exist_ok=True)
    (root / "corpus" / "citation_map.json").write_text(json.dumps(result, indent=1, ensure_ascii=False))
    with open(root / "corpus" / "citation_map_review.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["act", "page", "new", "subject", "old_raw", "old", "status", "from_text"], extrasaction="ignore")
        w.writeheader()
        for r in review:
            w.writerow({**r, "old": " ".join(r["old"])})


if __name__ == "__main__":
    main()
