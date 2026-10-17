import importlib.util
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, root / "tools" / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_score_review_majority_and_flags(tmp_path, monkeypatch=None):
    import sys
    sc = _load("score_review")
    (tmp_path / "corpus/review/replies").mkdir(parents=True)
    (tmp_path / "tests/eval").mkdir(parents=True)
    qs = [{"id": "f01", "type": "find_case", "lawyer": "criminal", "gold_cases": ["c1"], "question": "q"},
          {"id": "t07", "type": "trap", "lawyer": "", "gold_cases": [], "question": "t"}]
    (tmp_path / "tests/eval/judgment_questions.json").write_text(json.dumps(qs))
    (tmp_path / "corpus/review/judgment_review_key.json").write_text(json.dumps({"f01": {"A": "c1", "B": "c2", "C": "c3"}}))
    r1 = [{"id": "f01", "candidates": {"A": "FULL", "B": "FULL", "C": "NO"}, "answer": "FAITHFUL"},
          {"id": "t07", "trap_verdict": "REFUSE_CORRECT"}]
    r2 = [{"id": "f01", "candidates": {"A": "FULL", "B": "PARTIAL", "C": "NO"}, "answer": "PARTLY", "missing_case": "X v Y"},
          {"id": "t07", "trap_verdict": "SHOULD_ANSWER"}]
    r3 = "Here you go:\n" + json.dumps([{"id": "f01", "candidates": {"A": "PARTIAL", "B": "NO", "C": "NO"}, "answer": "FAITHFUL"},
                                        {"id": "t07", "trap_verdict": "REFUSE_CORRECT"}]) + "\nthanks"
    files = []
    for i, r in enumerate((r1, r2, r3)):
        p = tmp_path / f"corpus/review/replies/r{i}.json"
        p.write_text(r if isinstance(r, str) else json.dumps(r))
        files.append(str(p))
    import sys as _s
    _s.argv = ["score_review", "--root", str(tmp_path)] + files
    sc.main()
    out = json.loads((tmp_path / "tests/eval/judgment_questions.reviewed.json").read_text())
    f01 = out[0]
    assert f01["acceptable_cases"] == ["c1"] or f01["acceptable_cases"] == []      # A: 2 FULL of 3 -> c1 accepted
    assert f01["acceptable_cases"] == ["c1"] and f01["partial_cases"] == ["c2"] and f01["missing_case_suggestions"] == ["X v Y"]
    assert out[1]["trap_verdicts"] == {"REFUSE_CORRECT": 2, "SHOULD_ANSWER": 1}
