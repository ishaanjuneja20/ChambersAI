from backend.rag.retrieve import retrieve


def test_retrieve_format():
    hits = retrieve("punishment for murder", "criminal")
    assert hits and {"chunk", "score"} <= hits[0].keys()
    assert hits[0]["chunk"]["citation"]
