
import os
import base64
import logging
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException
from fishaudio import AsyncFishAudio

logger = logging.getLogger(__name__)

# Load environment variables from backend/.env
load_dotenv(Path(__file__).resolve().parent / ".env")

FISH_KEY = os.getenv("FISH_API_KEY")

if not FISH_KEY:
    raise RuntimeError(
        "FISH_API_KEY is missing from backend/.env"
    )

# Initialize Fish Audio client
fish_client = AsyncFishAudio(api_key=FISH_KEY)


async def stream_tts_sentence(
    sentence: str,
    voice_id: str,
):
    """
    Convert text into speech using the selected lawyer's voice.

    Yields Base64-encoded MP3 audio chunks for SSE streaming.
    """

    if not sentence or not sentence.strip():
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty.",
        )

    if not voice_id:
        raise HTTPException(
            status_code=400,
            detail="Voice ID is required.",
        )

    try:
        audio_stream = await fish_client.tts.stream(
            text=sentence.strip(),
            model="s2.1-pro-free",
            reference_id=voice_id,
            latency="balanced",
            format="mp3",
        )

        async for chunk in audio_stream:
            if chunk:
                yield base64.b64encode(chunk).decode("ascii")

    except Exception as exc:
        logger.exception("Fish Audio TTS failed")

        raise HTTPException(
            status_code=502,
            detail="Speech generation failed. Check server logs.",
        ) from exc
