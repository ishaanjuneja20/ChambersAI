#!/usr/bin/env python3
"""Add the BSA 2023 <-> Indian Evidence Act 1872 section correspondence to corpus/citation_map.json (key "bsa").

Source: the comparison table of the Act as passed (Act 47 of 2023; "Comparison of BSA 2023.pdf", hosted by the Tripura
government). Only the section NUMBERS are used; headings and remarks are not copied anywhere.
(The UP Police PDF compares the earlier Bill, whose clause numbers differ from the Act, so it is not used.)

Usage (from the data folder):
    python3 tools/build_bsa_map.py --root . [--pdf statutes/criminal/comparison_BSA_to_IEA.pdf]
Needs: pip install pdfplumber. Then run tools/apply_citation_map.py to put the labels on the BSA chunks.
Writes corpus/citation_map.json (adds "bsa") and corpus/bsa_map_review.csv.
"""
import argparse, csv, json, re
from pathlib import Path

import pdfplumber

BSA_RE = re.compile(r"^\d{1,3}[A-Z]{0,2}(\(\w+\))*$")
IEA_RE = re.compile(r"^\d{1,3}[A-Z]{0,2}(\s*,\s*(Para|para|Proviso|Explanation|Illustration)[^,]*)?(\s*(,|&|and|to)\s*\d{1,3}[A-Z]{0,2})*$")
NEWISH = ("--", "—", "-", "")


def clean(c):
    return re.sub(r"\s+", " ", (c or "").replace("\n", " ")).strip()


def top(sec):
    return re.match(r"\d{1,3}[A-Z]{0,2}", sec).group(0)


def iea_numbers(cell):
    cell = re.sub(r"(?i)\b(para|proviso|explanation|illustration)\b\s*\w*", "", cell)
    return re.findall(r"\d{1,3}[A-Z]{0,2}", cell)


def rows(path):
    out = []
    with pdfplumber.open(path) as pdf:
        for pn, page in enumerate(pdf.pages, 1):
            for table in page.extract_tables():
                for r in table:
                    cells = [clean(x) for x in r]
                    if not cells or not BSA_RE.match(cells[0].replace(" ", "")) or cells[0] == "":
                        continue
                    rest = [x for x in cells[2:] if x != ""]       # IEA section, IEA heading, remarks (spacers removed)
                    iea = rest[0] if rest else ""
                    out.append({"page": pn, "bsa": cells[0].replace(" ", ""), "iea_raw": iea,
                                "remark": rest[-1] if len(rest) >= 3 else ""})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--pdf", default="statutes/criminal/comparison_BSA_to_IEA.pdf")
    a = ap.parse_args()
    root = Path(a.root)
    rs = rows(root / a.pdf)
    sections, review = {}, []
    for r in rs:
        raw = re.sub(r"(?<=\d)\s*-\s*(?=[A-Z])", "", r["iea_raw"]).rstrip(". ")     # "65-A." -> "65A"
        if raw in NEWISH:
            toks, status = [], "new"
        elif IEA_RE.match(raw):
            toks, status = iea_numbers(raw), "mapped"
        else:
            toks, status = [], "unparsed"
        r.update({"old": toks, "status": status})
        review.append(r)
        s = sections.setdefault(top(r["bsa"]), {"old": [], "status": set(), "rows": 0, "whole_row": None})
        s["rows"] += 1
        if r["bsa"] == top(r["bsa"]):
            s["whole_row"] = {"old": toks, "status": status, "old_raw": raw}
        for t in toks:
            if t not in s["old"]:
                s["old"].append(t)
        s["status"].add(status)
    for v in sections.values():
        v["status"] = sorted(v["status"])
    cm_path = root / "corpus" / "citation_map.json"
    cmap = json.loads(cm_path.read_text(encoding="utf-8"))
    cmap["bsa"] = {"old_act": "IEA", "sections": sections}
    cm_path.write_text(json.dumps(cmap, indent=1, ensure_ascii=False), encoding="utf-8")
    with open(root / "corpus" / "bsa_map_review.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["page", "bsa", "iea_raw", "old", "status", "remark"], extrasaction="ignore")
        w.writeheader()
        for r in review:
            w.writerow({**r, "old": " ".join(r["old"])})
    bad = [r for r in review if r["status"] == "unparsed"]
    print(f"bsa: {len(rs)} rows, {len(sections)} distinct BSA sections, {sum(1 for r in review if r['status']=='new')} new, {len(bad)} unparsed")
    for r in bad:
        print("  unparsed:", r["bsa"], repr(r["iea_raw"]))


if __name__ == "__main__":
    main()
