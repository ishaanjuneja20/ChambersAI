"""Fish Audio TTS with word timestamps, for lip-sync.

Uses Fish's `POST /v1/tts/stream/with-timestamp` (SSE). Each event carries a base64 audio chunk and, when
available, the latest cumulative alignment snapshot for its text chunk (`chunk_seq`); segment times are
relative to that chunk, whose start in the full audio is `chunk_audio_offset_sec`.
Observed granularity: one segment per word for Latin script; for Devanagari, one segment per syllable
with the vowel signs dropped (e.g. पुलिस -> प, ल, स). No phoneme timing is provided.
"""
from __future__ import annotations

import base64
import json
from typing import Any, Iterable

import httpx

FISH_TIMESTAMP_URL = "https://api.fish.audio/v1/tts/stream/with-timestamp"


def merge_timestamp_events(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Audio chunks concatenated in arrival order; segments from the latest snapshot of each text chunk,
    shifted onto the full audio's timeline and sorted by start."""
    audio = bytearray()
    latest: dict[int, dict[str, Any]] = {}
    offsets: dict[int, float] = {}
    for ev in events:
        if ev.get("audio_base64"):
            audio += base64.b64decode(ev["audio_base64"])
        seq = int(ev.get("chunk_seq") or 0)
        if ev.get("alignment"):
            latest[seq] = ev["alignment"]                         # a snapshot replaces, never appends
            offsets[seq] = float(ev.get("chunk_audio_offset_sec") or 0.0)
    segments = []
    for seq in sorted(latest):
        for seg in latest[seq].get("segments") or []:
            segments.append({"text": str(seg["text"]),
                             "start": round(float(seg["start"]) + offsets[seq], 3),
                             "end": round(float(seg["end"]) + offsets[seq], 3)})
    segments.sort(key=lambda s: s["start"])
    return {"audio": bytes(audio), "segments": segments}


async def synthesize_with_timestamps(text: str, voice_id: str, api_key: str, *, model: str,
                                     language: str | None = None) -> dict[str, Any]:
    """One request to Fish; same model / format / latency as the plain streaming TTS so the voice is unchanged.
    Raises httpx.HTTPError on transport or HTTP errors."""
    body: dict[str, Any] = {"text": text, "reference_id": voice_id, "format": "mp3", "latency": "balanced"}
    if language:
        body["language"] = language                             # used by Fish for normalisation and alignment
    events = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        async with client.stream("POST", FISH_TIMESTAMP_URL, json=body,
                                 headers={"Authorization": f"Bearer {api_key}", "model": model}) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    payload = line[5:].strip()
                    if payload and payload != "[DONE]":
                        events.append(json.loads(payload))
    return merge_timestamp_events(events)
