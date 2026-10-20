import base64
import json
from pathlib import Path

import httpx

# Put your recording in the backend folder with this name.
audio_path = Path("input_audio.mp3")
output_path = Path("voice_response.mp3")

if not audio_path.exists():
    raise FileNotFoundError(
        "Place your recording in backend/input_audio.mp3"
    )

audio_chunks = []

with httpx.stream(
    "POST",
    "http://127.0.0.1:8000/api/test-voice",
    files={
        "audio_file": (
            audio_path.name,
            audio_path.read_bytes(),
            "audio/mpeg",
        )
    },
    data={"lawyer_id": "criminal"},
    timeout=120.0,
) as response:

    response.raise_for_status()

    for line in response.iter_lines():
        if not line.startswith("data: "):
            continue

        payload = line[len("data: "):].strip()

        if payload == "[DONE]":
            break

        # Report errors sent through the SSE stream.
        if payload.startswith("{"):
            error = json.loads(payload)
            raise RuntimeError(
                error.get("message", "TTS generation failed.")
            )

        if payload:
            audio_chunks.append(base64.b64decode(payload))

if not audio_chunks:
    raise RuntimeError("No audio chunks were received.")

output_path.write_bytes(b"".join(audio_chunks))

print(f"Audio saved to: {output_path.resolve()}")
print("Open voice_response.mp3 to hear the response.")