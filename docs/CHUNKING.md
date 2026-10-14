# Chunking

## Acts (done for English): `tools/chunk_acts.py`
- One chunk per section (Constitution: per article). Sections over 3,500 chars are split at sub-clause boundaries and keep the section id with `-p2`, `-p3` suffixes.
- Schedules are chunked by size (`kind: act_schedule`).
- Each chunk: citation (e.g. `BNS s.103`), title, chapter/part label, year, source path, and the amendment footnotes (kept in `meta.footnotes`, removed from `text`).
- Omitted/repealed sections get no chunk; they are listed in the Act's report.
- Ids are `<act_short_lowercase>-<section>`, e.g. `bns_2023-103`.

### How sections are found
1. `pdftotext -layout` text, cached in `corpus/acts_text/<Act>_en.txt`.
2. Candidate headings are indented `NUM. Title<dash>` lines; the table of contents has no dash, so it is ignored.
3. The longest increasing run of section numbers is kept (drops footnote noise).
4. The table of contents is the check: any entry the strict pass missed is looked for in the gap between its neighbours (the "rescue" pass), and anything still missing is listed.

### Results (25 English Acts)
3,230 sections -> 3,713 chunks. Sections missing against each Act's contents list:
- Constitution Art. 238 (omitted article)
- Hindu Adoptions and Maintenance Act s.4
- Indian Contract Act s.24
- Specific Relief Act ss.43, 44 (repealed)

HAMA s.4 and ICA s.24 are real sections and need a manual look at the PDF.

### Running and resuming
Run from the data folder (`~/Desktop/RAG Datasets`):

    python3 tools/chunk_acts.py --root .

An Act whose `corpus/chunks/acts/<Act>.jsonl` exists is skipped. Output is written to a temp file and renamed, so a crash never leaves a half-written Act. Use `--force` to redo everything or `--only <Act>` for one. `corpus/chunks/acts/_summary.csv` shows counts and gaps per Act.

## Hindi
All 22 Hindi PDFs have been OCR'd (`statutes/<domain>/*_hi.ocr.txt`, Tesseract hin+eng). The India Code `*_hi_indiacode.txt` files and the PDF text layers are corrupted (legacy fonts), so OCR is the only Hindi source.

OCR is too noisy to chunk by section number: it drops leading digits (BNS s.103 reads "03.") and misses most headings. Aligning Hindi headings to the English section list (monotone match, OCR number must be a suffix of the English number) recovers only part of each Act:

| Act | English sections | Hindi headings found | Aligned |
|---|---|---|---|
| BNS | 358 | 169 | 144 |
| BSA | 170 | 81 | 75 |
| Consumer Protection Act | 107 | 50 | 47 |
| Hindu Marriage Act | 35 | 25 | 19 |

Decision (see `DECISIONS.md`): no Hindi chunks for now. Hindi queries retrieve the English chunks through a multilingual embedding model, and the answer is generated in Hindi. The OCR text is kept for later.

## BNS <-> IPC and BNSS <-> CrPC labels
`tools/build_citation_map.py` reads the two comparison PDFs (needs `pip install pdfplumber`) into `corpus/citation_map.json`; `tools/apply_citation_map.py` then adds `meta.formerly`, `meta.formerly_act`, `meta.is_new` and a label such as `BNS s.103 (formerly IPC s.302)` to the BNS and BNSS chunks. It is safe to rerun. Run it again after `chunk_acts.py --force`, because that rewrites the citations.

Source caveat: the tables are hosted by Kerala Prisons but authored by a police-academy officer, not India Code. Only the section numbers are used (the prose summary is not copied). Spot checks matched known mappings (BNS 103->IPC 302, 85->498A, 64->376, 318->420; BNSS 173->CrPC 154, 187->167, 482->438, 528->482), but the full table has not been verified against a lawyer-checked source. Labels longer than four old sections are left off the citation and kept in `meta.formerly`.

Coverage: all 358 BNS and 531 BNSS sections have an entry. BSA<->Evidence Act has no table yet.

## Not done yet
- BNS<->IPC and BNSS<->CrPC citation mapping (from the official comparison PDFs).
- Judgments (paragraph chunks, or one summary vector per case first; see `DECISIONS.md`).
