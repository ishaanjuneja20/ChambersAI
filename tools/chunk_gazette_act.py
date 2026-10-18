#!/usr/bin/env python3
"""Chunk a short Act from its official Gazette of India PDF (two-column layout: the section's marginal note sits in the
left or right margin). tools/chunk_acts.py cannot read this layout (it merges the notes into the text), so this
reads the word positions with `pdftotext -bbox-layout`, keeps the body column, and uses the marginal note as the
section title. No text is generated: the section text is the PDF's own text, in reading order.

    python3 tools/chunk_gazette_act.py --root . MuslimWomenMarriageAct_2019

Reads  statutes/<domain>/<Name>_en.pdf  (the Act must be listed in ACTS in tools/chunk_acts.py)
Writes corpus/chunks/acts/<Name>.jsonl and <Name>.report.json, same record format as chunk_acts.py.
Page layout assumptions (checked on the 2019 Muslim Women Act, Gazette Extraordinary): body text starts at x >= 105,
margin notes are at x < 105 or x >= 478 (points), the running header is above y = 80, the Act ends at a line of dashes.
"""
import argparse, html, importlib.util, json, re, subprocess, sys
from pathlib import Path

LEFT, RIGHT, TOP = 105.0, 478.0, 80.0
LINE_RE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', re.S)
WORD_RE = re.compile(r">([^<]*)</word>")
SECTION_RE = re.compile(r"^(\d{1,3}[A-Z]{0,2})\.\s+(.*)$")
CHAPTER_RE = re.compile(r"^CHAPTER\s+[IVXLC]+$")
CROSSREF_RE = re.compile(r"^(Ord\.\s*)?\d+\s+of\s+\d{4}\.?$")
SMALLCAPS_RE = re.compile(r"\b([A-Z]) ([A-Z]{2,})\b")


def load_acts():
    spec = importlib.util.spec_from_file_location("chunk_acts", Path(__file__).with_name("chunk_acts.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.ACTS


def read_lines(pdf):
    out = subprocess.run(["pdftotext", "-bbox-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    pages = []
    for p in out.split("<page ")[1:]:
        rows = []
        for x0, y0, _x1, _y1, body in LINE_RE.findall(p):
            text = " ".join(html.unescape(w) for w in WORD_RE.findall(body)).strip()
            if text:
                rows.append((float(x0), float(y0), text))
        pages.append(rows)
    return pages


def clusters(rows):
    """Group margin lines of one side into notes: consecutive lines less than 12 pt apart."""
    notes, cur = [], []
    for x, y, t in sorted(rows, key=lambda r: r[1]):
        if cur and y - cur[-1][1] > 12:
            notes.append(cur)
            cur = []
        cur.append((x, y, t))
    if cur:
        notes.append(cur)
    return [(c[0][1], " ".join(t for _x, _y, t in c)) for c in notes]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("name")
    a = ap.parse_args()
    root = Path(a.root)
    domain, act_name, year, abbr, _style = load_acts()[a.name]
    rel = f"statutes/{domain}/{a.name}_en.pdf"
    pages = read_lines(root / rel)

    secs = []                                   # [num, page, y, [lines], chapter]
    chapter, skip_title, started, ended = "", False, False, False
    notes_by_page = []
    for pi, rows in enumerate(pages):
        rows = [r for r in rows if r[1] >= TOP]
        body = sorted([r for r in rows if LEFT <= r[0] < RIGHT], key=lambda r: r[1])
        margin = [r for r in rows if not (LEFT <= r[0] < RIGHT)]
        notes = []
        for side in ([r for r in margin if r[0] < LEFT], [r for r in margin if r[0] >= RIGHT]):
            notes += [(y, t) for y, t in clusters(side) if not CROSSREF_RE.match(t)]
        notes_by_page.append(notes)
        for _x, y, text in body:
            if ended:
                break
            if re.fullmatch(r"[—\-–_]{3,}", text):
                ended = True
                break
            if skip_title:
                chapter += " " + SMALLCAPS_RE.sub(r"\1\2", text)
                skip_title = False
                continue
            if CHAPTER_RE.match(text):
                chapter, skip_title = text, True
                continue
            m = SECTION_RE.match(text)
            if m and (started or m.group(1) == "1"):
                started = True
                secs.append([m.group(1), pi, y, [m.group(2)], chapter])
            elif started:
                secs[-1][3].append(text)

    chunks = []
    for num, pi, y, lines, chap in secs:
        near = [(abs(ny - y), t) for ny, t in notes_by_page[pi] if abs(ny - y) <= 12]
        title = min(near)[1].rstrip(".").strip() if near else ""
        body = "\n".join(lines)
        text = f"{num}. {title}.―{body}" if title else f"{num}. {body}"
        chunks.append({
            "id": f"{a.name.lower()}-{num.lower()}", "kind": "act_section", "text": text, "lang": "en", "domains": [domain],
            "citation": f"{abbr} s.{num}",
            "meta": {"act": act_name, "act_short": a.name, "section": num, "title": title, "chapter": chap.strip(), "part": None,
                     "case_name": None, "year": year, "court": None, "source_path": rel, "footnotes": []}})
    out = root / "corpus" / "chunks" / "acts"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{a.name}.jsonl").write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in chunks), encoding="utf-8")
    nums = [c["meta"]["section"] for c in chunks]
    report = {"act": a.name, "sections": nums, "chunks": len(chunks), "without_title": [c["meta"]["section"] for c in chunks if not c["meta"]["title"]],
              "min_chars": min(len(c["text"]) for c in chunks), "max_chars": max(len(c["text"]) for c in chunks)}
    (out / f"{a.name}.report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
