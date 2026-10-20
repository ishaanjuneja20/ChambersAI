import base64

import pytest

from backend.tts_timing import merge_timestamp_events


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def test_merge_offsets_and_snapshot_replacement():
    events = [
        {"audio_base64": _b64(b"aa"), "chunk_seq": 0, "chunk_audio_offset_sec": 0, "alignment": None},
        {"audio_base64": _b64(b"bb"), "chunk_seq": 0, "chunk_audio_offset_sec": 0,
         "alignment": {"segments": [{"text": "My", "start": 0, "end": 0.3}]}},
        # a later snapshot for the same chunk replaces the earlier one
        {"audio_base64": _b64(b"cc"), "chunk_seq": 0, "chunk_audio_offset_sec": 0,
         "alignment": {"segments": [{"text": "My", "start": 0, "end": 0.32},
                                    {"text": "property", "start": 0.32, "end": 0.8}]}},
        {"audio_base64": _b64(b"dd"), "chunk_seq": 1, "chunk_audio_offset_sec": 2.5,
         "alignment": {"segments": [{"text": "Next", "start": 0.0, "end": 0.24}]}},
    ]
    out = merge_timestamp_events(events)
    assert out["audio"] == b"aabbccdd"                      # arrival order
    assert out["segments"] == [
        {"text": "My", "start": 0.0, "end": 0.32},
        {"text": "property", "start": 0.32, "end": 0.8},
        {"text": "Next", "start": 2.5, "end": 2.74},        # shifted onto the full audio's timeline
    ]


def test_merge_without_alignment():
    out = merge_timestamp_events([{"audio_base64": _b64(b"x"), "chunk_seq": 0, "alignment": None}])
    assert out == {"audio": b"x", "segments": []}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("CHAMBERS_WARMUP", "0")
    from fastapi.testclient import TestClient
    import backend.main as M

    async def fake_tts(text, voice_id, language=None):
        fake_tts.calls.append((text, voice_id, language))
        return {"audio": b"ID3fake", "segments": [{"text": "Hello", "start": 0.0, "end": 0.4}]}

    fake_tts.calls = []
    monkeypatch.setattr(M, "VOICE_ERROR", None)
    monkeypatch.setattr(M, "tts_with_timestamps", fake_tts)
    return TestClient(M.app), fake_tts


def test_speak_returns_audio_and_timing(client):
    c, fake = client
    r = c.post("/api/speak", json={"text": "  Hello.  ", "lawyer_id": "constitutional", "lang": "en"})
    assert r.status_code == 200
    body = r.json()
    assert base64.b64decode(body["audio_base64"]) == b"ID3fake"
    assert body["format"] == "mp3"
    assert body["timing"] == {"source": "fish-timestamps", "segments": [{"text": "Hello", "start": 0.0, "end": 0.4}]}
    assert fake.calls[0][0] == "Hello." and fake.calls[0][2] == "en"


def test_speak_validation(client):
    c, _ = client
    assert c.post("/api/speak", json={"text": " ", "lawyer_id": "constitutional"}).status_code == 400
    assert c.post("/api/speak", json={"text": "x" * 1001, "lawyer_id": "constitutional"}).status_code == 400
    assert c.post("/api/speak", json={"text": "Hi", "lawyer_id": "nobody"}).status_code == 400
    assert c.post("/api/speak", json={"text": "Hi", "lawyer_id": "family", "lang": "fr"}).status_code == 422


def test_speak_without_voice_keys(client, monkeypatch):
    c, _ = client
    import backend.main as M
    monkeypatch.setattr(M, "VOICE_ERROR", "FISH_API_KEY is missing")
    assert c.post("/api/speak", json={"text": "Hi", "lawyer_id": "family"}).status_code == 503
