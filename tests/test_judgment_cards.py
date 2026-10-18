import importlib.util
import pathlib

_spec = importlib.util.spec_from_file_location(
    "build_judgment_cards", pathlib.Path(__file__).resolve().parents[1] / "tools" / "build_judgment_cards.py")
cards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cards)

REPORTED = (
    "1092\n\n[2019] 13\nS.C.R. 1092\nSUPREME COURT\nREPORTS\n\nA\n\nRAJASTHAN PSC v. SHIKUN RAM\nB\n\n"
    "(Civil Appeal No. 8146 of 2019)\nOCTOBER 25, 2019\n[L. NAGESWARA RAO AND HEMANT GUPTA, JJ.]\n\nC\n\nD\n\n"
    "Service law - Ex-servicemen category - Held: change of category not allowed.\n"
)


def test_card_starts_after_bench_line_and_drops_margin_letters():
    card, found = cards.card_text("A versus B", "[2019] 13 S.C.R. 1092", 2019, REPORTED)
    assert found
    body = card.split("\n", 1)[1]
    assert body.startswith("Service law")
    assert "NAGESWARA" not in body


def test_header_carries_metadata_only():
    card, _ = cards.card_text("A versus B", "[2019] 13 S.C.R. 1092", 2019, REPORTED)
    assert card.split("\n", 1)[0] == "A versus B | [2019] 13 S.C.R. 1092 | 2019"


def test_ocr_damaged_bench_line_still_found():
    _, found = cards.card_text("A v. B", "", 1950, "x\n[MEHR CHAND MAHAJAN, R. S. NAIK and\nKHALILUZZAMAN\n\nJJ.J\n\nRes iudicata")
    assert found


def test_fallback_without_bench_line_and_length_cap():
    card, found = cards.card_text("A v. B", "", 1950, "word " * 2000)
    assert not found and len(card.split("\n", 1)[1]) <= cards.CARD_CHARS


def test_title_falls_back_to_parties_then_path():
    assert cards.case_title({"title": "", "petitioner": "X", "respondent": "Y"}, "p") == "X versus Y"
    assert cards.case_title({}, "1950_1_2_3") == "1950_1_2_3"
