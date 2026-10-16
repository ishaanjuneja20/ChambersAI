"""Stub retriever: returns fake hits in the real format (see docs/CONTRACTS.md)."""

FAKE_CHUNK = {
    "id": "bns-103",
    "kind": "act_section",
    "text": "(Stub) Whoever commits murder shall be punished with death or imprisonment for life, and shall also be liable to fine.",
    "lang": "en",
    "domains": ["criminal"],
    "citation": "BNS s.103 (formerly IPC s.302)",
    "meta": {"act": "BNS", "section": "103", "case_name": None, "year": None, "court": None,
             "source_path": "statutes/criminal/BNS_2023.pdf"},
}


def retrieve(query: str, lawyer_domain: str, k: int = 5) -> list[dict]:
    return [{"chunk": FAKE_CHUNK, "score": 0.9}][:k]
