
import os
import logging
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import HTTPException
from groq import AsyncGroq

logger = logging.getLogger(__name__)

load_dotenv(Path(__file__).resolve().parent / ".env")

api_key = os.getenv("GROQ_API_KEY")

if not api_key:
    raise RuntimeError(
        "GROQ_API_KEY is missing from backend/.env"
    )

client = AsyncGroq(api_key=api_key)


async def transcribe_audio_with_metadata(
    audio_bytes: bytes,
    filename: str,
    language: str | None = None,
) -> dict[str, Any]:
    """
    Transcribe speech and return both the text
    and Whisper's detected-language metadata.
    """

    if not audio_bytes:
        raise HTTPException(
            status_code=400,
            detail="No audio was provided.",
        )

    try:
        request: dict[str, Any] = {
            "file": (filename, audio_bytes),
            "model": "whisper-large-v3-turbo",
            "response_format": "verbose_json",
            "temperature": 0.0,
        }

        # Ignore Swagger placeholders so language detection
        # happens automatically when no real language is supplied.
        if language:
            language = language.strip().lower()

            if language not in {
                "", "string", "auto", "automatic", "none"
            }:
                request["language"] = language

        result = await client.audio.transcriptions.create(
            **request
        )

        transcript = result.text.strip()
        detected_language = getattr(result, "language", None)

        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="No speech was recognized.",
            )

        return {
            "text": transcript,
            "detected_language": detected_language,
        }

    except HTTPException:
        raise

    except Exception as exc:
        logger.exception("Whisper transcription failed")

        raise HTTPException(
            status_code=502,
            detail="Speech recognition failed. Check server logs.",
        ) from exc


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str,
    language: str | None = None,
) -> str:
    """
    Compatibility wrapper for existing endpoints
    that need only the transcribed text.
    """

    result = await transcribe_audio_with_metadata(
        audio_bytes=audio_bytes,
        filename=filename,
        language=language,
    )

    return result["text"]
