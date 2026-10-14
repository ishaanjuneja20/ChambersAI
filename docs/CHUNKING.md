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

## Not done yet
- Hindi chunks aligned to English section numbers. Only 5 Acts have usable Hindi (the OCR'd BNS, BNSS, BSA, Industrial Relations Code, Constitution). The `*_hi_indiacode.txt` files and the other Hindi PDFs have a corrupted text layer and would need OCR.
- BNS<->IPC and BNSS<->CrPC citation mapping (from the official comparison PDFs).
- Judgments (paragraph chunks, or one summary vector per case first; see `DECISIONS.md`).
