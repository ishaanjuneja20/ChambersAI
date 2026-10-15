import importlib.util
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "tools"))
_spec = importlib.util.spec_from_file_location("build_judgment_chunks", root / "tools" / "build_judgment_chunks.py")
ch = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ch)

TEXT = (
    "12. The appellant was\nemployed in the service.\n\n"
    "13. The High Court held that\nthe order was bad. We agree.\n\n"
    "B\n\n[2019] 13 S.C.R. 1092\n\n"
    "14. " + ("This is a long sentence about the law. " * 80) + "\n\n"
    "Appeal allowed.\n"
)


def test_paragraphs_join_wrapped_lines_and_drop_furniture():
    ps = ch.paragraphs(TEXT)
    assert ps[0] == "12. The appellant was employed in the service."
    assert not any(p in ("B", "[2019] 13 S.C.R. 1092") for p in ps)


def test_chunks_respect_max_size_and_keep_paragraph_numbers():
    chunks = ch.chunk_text(TEXT, max_chars=600, min_chars=100)
    assert all(len(t) <= 700 for _, t in chunks)
    assert chunks[0][0] == 12
    assert any(no == 14 for no, _ in chunks)


def test_no_text_is_lost():
    chunks = ch.chunk_text(TEXT, max_chars=600, min_chars=100)
    joined = " ".join(t for _, t in chunks)
    assert "Appeal allowed." in joined and "The High Court held that the order was bad." in joined


def test_unbroken_text_is_hard_split():
    chunks = ch.chunk_text("x" * 5000, max_chars=1000, min_chars=100)
    assert len(chunks) >= 5 and all(len(t) <= 1000 for _, t in chunks)


def test_empty_text():
    assert ch.chunk_text("") == []
