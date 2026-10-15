#!/usr/bin/env python3
"""Chunk English Acts into one chunk per section (long sections split at sub-clauses).

Resumable: an Act whose output file already exists is skipped (use --force to redo).
Outputs are written to a temp file and renamed, so a half-finished Act never looks done.

Usage (from the data folder, e.g. ~/Desktop/RAG Datasets):
    python3 tools/chunk_acts.py --root . [--only BNS_2023] [--force]

Reads  statutes/<domain>/<Name>_en.pdf  (text cached in corpus/acts_text/<Name>_en.txt)
Writes corpus/chunks/acts/<Name>.jsonl, <Name>.report.json and corpus/chunks/acts/_summary.csv
"""
import argparse, csv, json, os, re, subprocess, sys
from pathlib import Path

MAX_CHARS = 3500          # split a section above this at sub-clause boundaries
DASH = "—―–‒⎯−─"             # dash variants used after section titles

# short_name: (domain, display name, year, citation style)
# citation style: "s" -> "<abbr> s.<n>", "art" -> "<abbr> Art.<n>"
ACTS = {
    "BNS_2023": ("criminal", "Bharatiya Nyaya Sanhita, 2023", 2023, "BNS", "s"),
    "BNSS_2023": ("criminal", "Bharatiya Nagarik Suraksha Sanhita, 2023", 2023, "BNSS", "s"),
    "BSA_2023": ("criminal", "Bharatiya Sakshya Adhiniyam, 2023", 2023, "BSA", "s"),
    "Constitution_of_India": ("constitutional", "Constitution of India", 1950, "Constitution", "art"),
    "RTIAct_2005": ("constitutional", "Right to Information Act, 2005", 2005, "RTI Act", "s"),
    "ConsumerProtectionAct_2019": ("consumer", "Consumer Protection Act, 2019", 2019, "CPA 2019", "s"),
    "IndianContractAct_1872": ("consumer", "Indian Contract Act, 1872", 1872, "Contract Act", "s"),
    "SaleOfGoodsAct_1930": ("consumer", "Sale of Goods Act, 1930", 1930, "Sale of Goods Act", "s"),
    "DomesticViolenceAct_2005": ("family", "Protection of Women from Domestic Violence Act, 2005", 2005, "DV Act", "s"),
    "GuardiansWardsAct_1890": ("family", "Guardians and Wards Act, 1890", 1890, "Guardians and Wards Act", "s"),
    "HinduAdoptionsMaintenanceAct_1956": ("family", "Hindu Adoptions and Maintenance Act, 1956", 1956, "HAMA", "s"),
    "HinduMarriageAct_1955": ("family", "Hindu Marriage Act, 1955", 1955, "HMA", "s"),
    "HinduSuccessionAct_1956": ("family", "Hindu Succession Act, 1956", 1956, "HSA", "s"),
    "SpecialMarriageAct_1954": ("family", "Special Marriage Act, 1954", 1954, "SMA", "s"),
    "CodeOnSocialSecurity_2020": ("labour", "Code on Social Security, 2020", 2020, "SS Code", "s"),
    "CodeOnWages_2019": ("labour", "Code on Wages, 2019", 2019, "Wages Code", "s"),
    "IndustrialRelationsCode_2020": ("labour", "Industrial Relations Code, 2020", 2020, "IR Code", "s"),
    "OSHCode_2020": ("labour", "Occupational Safety, Health and Working Conditions Code, 2020", 2020, "OSH Code", "s"),
    "POSHAct_2013": ("labour", "Sexual Harassment of Women at Workplace Act, 2013", 2013, "POSH Act", "s"),
    "LandAcquisitionAct_2013": ("property", "Right to Fair Compensation and Transparency in Land Acquisition Act, 2013", 2013, "LARR Act", "s"),
    "LimitationAct_1963": ("property", "Limitation Act, 1963", 1963, "Limitation Act", "s"),
    "RERA_2016": ("property", "Real Estate (Regulation and Development) Act, 2016", 2016, "RERA", "s"),
    "RegistrationAct_1908": ("property", "Registration Act, 1908", 1908, "Registration Act", "s"),
    "SpecificReliefAct_1963": ("property", "Specific Relief Act, 1963", 1963, "Specific Relief Act", "s"),
    "TransferOfPropertyAct_1882": ("property", "Transfer of Property Act, 1882", 1882, "TPA", "s"),
}

# "24.Agreements void ..." (no space after the dot, as in the Indian Contract Act and HAMA s.4) is accepted when a capital letter follows
HEAD_RE = re.compile(r"^(?P<ind> {2,}|\t+)(?:\d{1,2}\*?\[|\*?\[)?(?P<num>\d{1,3}[A-Z]{0,2})\.(?:\s+|(?=[A-Z]))(?P<rest>\S.*)$")
OMIT_RE = re.compile(r"\b(Omitted|Repealed|Rep\.)", re.I)
TITLE_DASH_RE = re.compile(r"^(?P<title>.{1,300}?)\s*\]?\.?\s*\]?\s*[%s]{1,2}" % DASH)
TOC_RE = re.compile(r"^\s{0,}\[?(?P<num>\d{1,3}[A-Z]{0,2})\.\s+(?P<title>\S.*?)\.?\s*$")
FOOT_START_RE = re.compile(r"^ {0,1}\d{1,3}\.\s+\S")
SCHED_RE = re.compile(r"^\s*(THE\s+)?((FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)\s+)?SCHEDULE\b")
SECTION_START_RE = re.compile(r"^\s*(?:\d{1,2}\*?\[|\*?\[)?\d{1,3}[A-Z]{0,2}\.")
PART_RE = re.compile(r"^\s*PART\s+[IVXLC0-9A-Z]+\s*$")
CHAP_ONLY_RE = re.compile(r"^\s*CHAPTER\s+[IVXLC]+\b[.\s—–-]*[A-Z ,.()'’—–-]*$")
END_RE = re.compile(r"^\s*(STATEMENT OF OBJECTS|LEGISLATIVE HISTORY|ANNEXURE)\b", re.I)
CHAPTER_RE = re.compile(r"^\s*(CHAPTER|PART)\s+[IVXLC0-9A-Z]+\b", re.I)
CLAUSE_RE = re.compile(r"^\s*\((\d+[A-Z]?|[a-z]{1,3}|[A-Z])\)\s")
WATERMARK_RE = re.compile(r"^\s{8,}[A-Za-z]{1,4}\s*$")


def key(num):
    m = re.match(r"(\d+)([A-Z]*)$", num)
    return (int(m.group(1)), (len(m.group(2)), m.group(2)))


def get_text(root, domain, name, cache_dir):
    cache = cache_dir / f"{name}_en.txt"
    if cache.exists() and cache.stat().st_size > 1000:
        return cache.read_text(errors="ignore")
    pdf = root / "statutes" / domain / f"{name}_en.pdf"
    if name == "Constitution_of_India":
        pdf = root / "statutes" / domain / "Constitution_of_India_English.pdf"
    cache_dir.mkdir(parents=True, exist_ok=True)
    subprocess.run(["pdftotext", "-layout", str(pdf), str(cache)], check=True, timeout=300)
    return cache.read_text(errors="ignore")


def clean_lines(text):
    """Remove watermark fragments and page-number lines; drop footnote blocks (kept separately)."""
    lines = text.replace("\r", "").split("\n")
    out, in_foot = [], False
    for ln in lines:
        ln = re.sub("[\uf000-\uf0ff]", "", ln.replace("\f", ""))
        if WATERMARK_RE.match(ln):
            continue
        if re.match(r"^\s{20,}\d{1,4}\s*$", ln):      # centred page number
            continue
        out.append(ln)
    return out


def find_headings(lines):
    """Candidate body headings: indented 'NUM. Title<dash>' (dash on same or next line)."""
    cands = []
    for i, ln in enumerate(lines):
        m = HEAD_RE.match(ln)
        if not m:
            continue
        t = None
        for extra in range(0, 4):
            if extra and i + extra < len(lines) and SECTION_START_RE.match(lines[i + extra]):
                break          # next heading started: the title did not wrap into it
            tail = " ".join(x.strip() for x in lines[i + 1:i + 1 + extra])
            joined = (m.group("rest") + " " + tail).strip()
            t = TITLE_DASH_RE.match(joined)
            if t:
                break
        if not t:
            continue
        title = t.group("title").strip()
        if len(title) < 2 or re.match(r"^(Ins|Subs|Omitted|Added|The words|Rep)\b", title) and False:
            continue
        cands.append((i, m.group("num"), title))
    return cands


def longest_chain(cands):
    """Longest strictly increasing (by section key) subsequence of candidates."""
    n = len(cands)
    if n == 0:
        return []
    best = [1] * n
    prev = [-1] * n
    ks = [key(c[1]) for c in cands]
    for i in range(n):
        for j in range(i):
            if ks[j] < ks[i] and best[j] + 1 > best[i]:
                best[i], prev[i] = best[j] + 1, j
    i = max(range(n), key=lambda x: best[x])
    chain = []
    while i != -1:
        chain.append(cands[i])
        i = prev[i]
    return chain[::-1]


def toc_entries(lines, first_body_line):
    """ToC (number, title) pairs found before the first body heading."""
    cands = []
    for i, ln in enumerate(lines[:first_body_line]):
        m = TOC_RE.match(ln)
        if m and not re.search(r"[%s]" % DASH, ln):
            cands.append((i, m.group("num"), m.group("title")))
    return [(c[1], c[2]) for c in longest_chain(cands)]


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def rescue(lines, heads, toc, report):
    """For ToC entries the strict pass missed, look inside the gap between neighbouring headings
    for a line that starts with the number and whose text matches the ToC title."""
    have = {h[1] for h in heads}
    added = []
    for num, ttl in toc:
        if num in have:
            continue
        before = [h for h in heads + added if key(h[1]) < key(num)]
        after = [h for h in heads + added if key(h[1]) > key(num)]
        lo = max(before, key=lambda h: key(h[1]))[0] + 1 if before else 0
        hi = min(after, key=lambda h: key(h[1]))[0] if after else len(lines)
        rx = re.compile(r"^\s*(?:\d{1,2}\*?\[|\*?\[|\d{1,2})?%s\.?\s*(?:[%s]+\s*)?(?P<rest>.*)$" % (re.escape(num), DASH))
        repealed = bool(OMIT_RE.search(ttl))
        for j in range(lo, hi):
            m = rx.match(lines[j])
            if not m:
                continue
            tail = " ".join(x.strip() for x in lines[j:j + 4])
            if repealed:
                if OMIT_RE.search(tail):
                    added.append((j, num, "OMITTED"))
                    break
            elif norm(ttl)[:10] and norm(ttl)[:10] in norm(tail)[:60]:
                added.append((j, num, ttl))
                break
    report["rescued"] = [a[1] for a in added]
    return sorted(heads + added)


def find_omitted(lines, chain):
    """Omitted/repealed section stubs that sit between two accepted headings."""
    out = []
    for k in range(len(chain) - 1):
        lo, hi = chain[k], chain[k + 1]
        for j in range(lo[0] + 1, hi[0]):
            m = HEAD_RE.match(lines[j])
            if m and OMIT_RE.search(m.group("rest")) and not re.search(r"[%s]" % DASH, m.group("rest")):
                if key(lo[1]) < key(m.group("num")) < key(hi[1]):
                    out.append((j, m.group("num"), "OMITTED"))
    return out


def split_footnotes(body_lines):
    """Separate footnote blocks (unindented 'N. Ins. by ...') from section text."""
    keep, notes, in_note = [], [], False
    for ln in body_lines:
        s = ln.rstrip()
        if not s.strip():
            in_note = False
            keep.append(s)
            continue
        if FOOT_START_RE.match(s) and not s.startswith("  "):
            in_note = True
            notes.append(s.strip())
            continue
        if in_note and not s.startswith("  "):
            notes[-1] += " " + s.strip()
            continue
        in_note = False
        keep.append(s)
    return keep, notes


def strip_trailing_headings(body_lines):
    """Pull trailing CHAPTER/PART/ALL-CAPS heading lines off a section; return (body, heading_text)."""
    i = len(body_lines)
    while i > 0:
        s = body_lines[i - 1].strip()
        letters = re.sub(r"[^A-Za-z]", "", s)
        if not s or CHAPTER_RE.match(s) or (letters and s.upper() == s and len(letters) >= 2) or re.match(r"^[IVXLC]+$", s):
            i -= 1
        else:
            break
    head = " ".join(x.strip() for x in body_lines[i:] if x.strip())
    return body_lines[:i], head


def chapter_marks(lines, start, end):
    """Find CHAPTER / PART headings (with their 1-3 title lines) inside [start, end).
    Returns ({line_idx: (kind, label)}, set(lines_to_drop))."""
    marks, drop = [], set()
    j = start
    while j < end:
        ln = lines[j]
        if CHAP_ONLY_RE.match(ln) or PART_RE.match(ln):
            kind = "part" if PART_RE.match(ln) else "chapter"
            label, k, used = [ln.strip()], j + 1, 0
            while k < end and used < 3:
                t = lines[k].strip()
                if not t:
                    k += 1
                    continue
                if SECTION_START_RE.match(lines[k]) or len(t) > 100 or t.startswith("("):
                    break
                label.append(t)
                used += 1
                k += 1
            marks.append((j, kind, " ".join(label)))
            drop.update(range(j, k))
            j = k
        else:
            j += 1
    return marks, drop


def normalise(lines):
    txt = "\n".join(l.strip() for l in lines)
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\n{3,}", "\n\n", txt)
    return txt.strip()


def split_long(text, max_chars=MAX_CHARS):
    if len(text) <= max_chars:
        return [text]
    parts, cur = [], []
    size = 0
    for ln in text.split("\n"):
        boundary = bool(CLAUSE_RE.match(ln))
        if cur and boundary and size >= max_chars * 0.6:
            parts.append("\n".join(cur).strip())
            cur, size = [], 0
        cur.append(ln)
        size += len(ln) + 1
        if size > max_chars * 1.6 and ln.rstrip().endswith((".", ";", ":")):
            parts.append("\n".join(cur).strip())
            cur, size = [], 0
    if cur:
        parts.append("\n".join(cur).strip())
    return [p for p in parts if p]


def chunk_act(name, root, cache_dir):
    domain, display, year, abbr, style = ACTS[name]
    text = get_text(root, domain, name, cache_dir)
    lines = clean_lines(text)
    cands = find_headings(lines)
    chain = longest_chain(cands)
    report = {"act": name, "candidates": len(cands), "sections": len(chain)}
    if not chain:
        report["error"] = "no section headings found"
        return [], report
    toc = toc_entries(lines, chain[0][0])
    expected = [t[0] for t in toc]
    chain = rescue(lines, chain, toc, report)
    chain = [c for c in chain if c[2] != "OMITTED"] + [c for c in chain if c[2] == "OMITTED"]
    chain = sorted(chain)
    found = [c[1] for c in chain if c[2] != "OMITTED"]
    report["toc_entries"] = len(expected)
    report["sections"] = len(found)
    omitted = find_omitted(lines, [c for c in chain if c[2] != "OMITTED"])
    omitted += [c for c in chain if c[2] == "OMITTED"]
    report["omitted"] = sorted({o[1] for o in omitted}, key=key)
    report["missing_vs_toc"] = [n for n in expected if n not in set(found) and n not in set(report["omitted"])]
    report["not_in_toc"] = [n for n in found if expected and n not in set(expected)]

    # end of the last section: first Schedule/objects marker after the last heading
    last_i = max(c[0] for c in chain)
    end_i, sched_start = len(lines), None
    for j in range(last_i + 1, len(lines)):
        if END_RE.match(lines[j]):
            end_i = j
            break
        if SCHED_RE.match(lines[j]) and len(lines[j].strip()) < 60 and sched_start is None:
            sched_start = j
            end_i = j
            break

    chunks = []
    heads = sorted(set([c for c in chain if c[2] != "OMITTED"] + omitted))
    bounds = [c[0] for c in heads] + [end_i]
    marks, drop = chapter_marks(lines, heads[0][0], end_i)
    for idx, (hl, num, title) in enumerate(heads):
        if title == "OMITTED":
            continue
        part_lbl = max([m for m in marks if m[0] < hl and m[1] == "part"], default=None, key=lambda m: m[0])
        chap_lbl = max([m for m in marks if m[0] < hl and m[1] == "chapter"], default=None, key=lambda m: m[0])
        if part_lbl and chap_lbl and chap_lbl[0] < part_lbl[0]:
            chap_lbl = None
        chapter = " / ".join(x[2] for x in (part_lbl, chap_lbl) if x)
        title = re.sub(r"\s+", " ", title).strip()
        body = [l for k, l in enumerate(lines[hl:bounds[idx + 1]], start=hl) if k not in drop]
        body, notes = split_footnotes(body)
        body, _ = strip_trailing_headings(body)
        body_txt = normalise(body)
        cite = f"{abbr} Art.{num}" if style == "art" else f"{abbr} s.{num}"
        for pi, part in enumerate(split_long(body_txt)):
            cid = f"{name.lower()}-{num.lower()}" + (f"-p{pi + 1}" if pi else "")
            chunks.append({
                "id": cid,
                "kind": "act_article" if style == "art" else "act_section",
                "text": part,
                "lang": "en",
                "domains": [domain],
                "citation": cite,
                "meta": {
                    "act": display, "act_short": name, "section": num, "title": title,
                    "chapter": chapter, "part": pi + 1 if pi else None,
                    "case_name": None, "year": year, "court": None,
                    "source_path": f"statutes/{domain}/{name}_en.pdf",
                    "footnotes": notes if pi == 0 else [],
                },
            })

    # schedules: chunk by size
    if sched_start is not None:
        sched_lines = [l for l in lines[sched_start:] if not END_RE.match(l)]
        sched_lines, _ = split_footnotes(sched_lines)
        stext = normalise(sched_lines)
        stext = stext if len(re.sub(r"[_\s.]", "", stext)) > 80 else ""
        for pi, part in enumerate(split_long(stext, 2500) if stext else []):
            chunks.append({
                "id": f"{name.lower()}-schedule-p{pi + 1}",
                "kind": "act_schedule",
                "text": part, "lang": "en", "domains": [domain],
                "citation": f"{abbr} Schedule",
                "meta": {"act": display, "act_short": name, "section": "Schedule", "title": "Schedule",
                         "chapter": "", "part": pi + 1, "case_name": None, "year": year, "court": None,
                         "source_path": f"statutes/{domain}/{name}_en.pdf", "footnotes": []},
            })

    sizes = [len(c["text"]) for c in chunks]
    report.update({
        "chunks": len(chunks), "min_chars": min(sizes), "max_chars": max(sizes),
        "tiny_chunks(<40)": [c["id"] for c in chunks if len(c["text"]) < 40][:20],
        "schedule_chunks": sum(1 for c in chunks if c["kind"] == "act_schedule"),
        "first_ids": [c["id"] for c in chunks[:3]], "last_ids": [c["id"] for c in chunks[-3:]],
    })
    return chunks, report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--only", default=None)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--text-dir", default=None, help="folder with <Name>_en.txt caches (default corpus/acts_text)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    root = Path(a.root).resolve()
    cache_dir = Path(a.text_dir) if a.text_dir else root / "corpus" / "acts_text"
    out_dir = Path(a.out) if a.out else root / "corpus" / "chunks" / "acts"
    out_dir.mkdir(parents=True, exist_ok=True)

    for name in ACTS:
        if a.only and name != a.only:
            continue
        outp = out_dir / f"{name}.jsonl"
        if outp.exists() and not a.force:
            print(f"skip {name} (done)")
            continue
        try:
            chunks, rep = chunk_act(name, root, cache_dir)
        except FileNotFoundError as e:
            print(f"!! {name}: source missing ({e.filename})")
            continue
        except Exception as e:
            print(f"!! {name}: {type(e).__name__}: {e}")
            continue
        if not chunks:
            print(f"!! {name}: {rep.get('error')}")
            (out_dir / f"{name}.report.json").write_text(json.dumps(rep, indent=1))
            continue
        tmp = outp.with_suffix(".jsonl.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            for c in chunks:
                f.write(json.dumps(c, ensure_ascii=False) + "\n")
        os.replace(tmp, outp)
        (out_dir / f"{name}.report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
        print(f"{name}: {rep['sections']} sections, {rep['chunks']} chunks, toc={rep.get('toc_entries')}, missing={len(rep['missing_vs_toc'])}")

    # summary of whatever is done
    rows = []
    for rp in sorted(out_dir.glob("*.report.json")):
        r = json.loads(rp.read_text())
        rows.append([r.get("act"), r.get("sections"), r.get("toc_entries"), len(r.get("missing_vs_toc", [])),
                     len(r.get("not_in_toc", [])), r.get("chunks"), r.get("min_chars"), r.get("max_chars"),
                     " ".join(r.get("missing_vs_toc", [])[:30])])
    with open(out_dir / "_summary.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["act", "sections", "toc_entries", "missing", "not_in_toc", "chunks", "min_chars", "max_chars", "missing_list"])
        w.writerows(rows)


if __name__ == "__main__":
    main()
