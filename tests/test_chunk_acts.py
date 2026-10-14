import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import chunk_acts as c

SAMPLE = """
   1. Short title.
   2. Definitions.
   3. Punishment.

   1. Short title.—(1) This Act may be called the Sample Act.
   2. Definitions.—In this Act, unless the context requires,—
      (a) "court" means a court of law;
   3. Punishment.—Whoever offends shall be punished.
""".split("\n")


def test_key_orders_suffixes():
    assert c.key("21") < c.key("21A") < c.key("21B") < c.key("22")
    assert c.key("243Z") < c.key("243ZA")


def test_headings_need_dash_so_toc_is_ignored():
    nums = [h[1] for h in c.find_headings(SAMPLE)]
    assert nums == ["1", "2", "3"]


def test_longest_chain_drops_out_of_order_noise():
    cands = [(1, "1", "a"), (2, "9", "noise"), (3, "2", "b"), (4, "3", "c")]
    assert [x[1] for x in c.longest_chain(cands)] == ["1", "2", "3"]


def test_split_long_keeps_everything():
    text = "\n".join(f"({i}) clause number {i} " + "x" * 200 for i in range(1, 40))
    parts = c.split_long(text, 3000)
    assert len(parts) > 1 and "".join(parts).replace("\n", "") == text.replace("\n", "").strip()
