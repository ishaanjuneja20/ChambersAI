
import json
import logging
from typing import Literal

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse

from audio_handler import stream_tts_sentence
from lawyers import LAWYERS
from stt_service import transcribe_audio_with_metadata


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ChambersAI Voice Backend")

MAX_AUDIO_BYTES = 15 * 1024 * 1024

LawyerID = Literal["criminal", "family", "property"]


# --------------------------------------------------
# 1. ROOT
# --------------------------------------------------

@app.get("/")
async def root():
    return {
        "status": "online",
        "message": "ChambersAI Backend is running!",
    }


# --------------------------------------------------
# 2. AVAILABLE LAWYERS
# --------------------------------------------------

@app.get("/api/lawyers")
async def list_lawyers():
    return [
        {
            "id": lawyer_id,
            "name": config["name"],
            "persona": config["persona"],
        }
        for lawyer_id, config in LAWYERS.items()
    ]


def get_lawyer_config(lawyer_id: str) -> dict:
    lawyer = LAWYERS.get(lawyer_id)

    if not lawyer:
        raise HTTPException(
            status_code=400,
            detail="Invalid lawyer ID.",
        )

    return lawyer


# --------------------------------------------------
# 3. READ AND VALIDATE AUDIO
# --------------------------------------------------

async def read_audio_upload(audio_file: UploadFile) -> bytes:
    try:
        audio_bytes = await audio_file.read(MAX_AUDIO_BYTES + 1)
    finally:
        await audio_file.close()

    if not audio_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded audio is empty.",
        )

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Audio exceeds the 15 MB limit.",
        )

    return audio_bytes


# --------------------------------------------------
# 4. SHARED WHISPER TRANSCRIPTION
# --------------------------------------------------

async def transcribe_uploaded_file(
    audio_file: UploadFile,
    language: str | None = None,
) -> dict:
    filename = audio_file.filename or "recording.webm"
    audio_bytes = await read_audio_upload(audio_file)

    # Ignore placeholder values sometimes entered through Swagger.
    if language:
        language = language.strip().lower()

        if language in {"", "string", "auto", "automatic", "none"}:
            language = None

    result = await transcribe_audio_with_metadata(
        audio_bytes=audio_bytes,
        filename=filename,
        language=language,
    )

    logger.info(
        "Transcription completed; detected language: %s",
        result["detected_language"],
    )

    return result


# --------------------------------------------------
# 5. TEST STT
# --------------------------------------------------

@app.post("/api/test-stt")
async def test_stt(
    audio_file: UploadFile = File(...),
    language: str | None = Form(None),
):
    """Transcribe audio and return text plus detected language."""

    return await transcribe_uploaded_file(
        audio_file,
        language,
    )


# --------------------------------------------------
# 6. FRONTEND STT ENDPOINT
# --------------------------------------------------

@app.post("/api/transcribe")
async def transcribe(
    audio_file: UploadFile = File(...),
):
    """
    Automatically detect speech language and transcribe it.
    The frontend does not need to send a language parameter.
    """

    return await transcribe_uploaded_file(audio_file)


# --------------------------------------------------
# 7. FISH AUDIO STREAMING
# --------------------------------------------------

async def audio_sse_generator(text: str, voice_id: str):
    try:
        async for chunk in stream_tts_sentence(text, voice_id):
            if chunk:
                yield f"data: {chunk}\n\n"

    except Exception:
        logger.exception("Audio streaming failed")

        error_data = json.dumps({
            "message": "Speech generation failed."
        })

        yield f"event: error\ndata: {error_data}\n\n"

    finally:
        yield "data: [DONE]\n\n"


def sse_response(text: str, voice_id: str):
    return StreamingResponse(
        audio_sse_generator(text, voice_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# --------------------------------------------------
# 8. TEST TTS
# --------------------------------------------------

@app.post("/api/test-tts")
async def test_tts(
    text: str = Form(...),
    lawyer_id: LawyerID = Form("criminal"),
):
    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty.",
        )

    if len(text) > 5000:
        raise HTTPException(
            status_code=400,
            detail="Text exceeds the 5000-character limit.",
        )

    lawyer = get_lawyer_config(lawyer_id)

    logger.info("Generating speech for %s", lawyer["name"])

    return sse_response(
        text.strip(),
        lawyer["voice_id"],
    )


# --------------------------------------------------
# 9. TEST STT + TTS LOOPBACK
# Speech -> Text -> Spoken text
# --------------------------------------------------

@app.post("/api/test-voice")
async def test_voice_loopback(
    audio_file: UploadFile = File(...),
    lawyer_id: LawyerID = Form("criminal"),
    language: str | None = Form(None),
):
    lawyer = get_lawyer_config(lawyer_id)

    result = await transcribe_uploaded_file(
        audio_file,
        language,
    )

    transcript = result["text"]
    detected_language = result["detected_language"]

    logger.info(
        "Voice loopback for %s; detected language: %s",
        lawyer["name"],
        detected_language,
    )

    # Testing only: speaks the recognized text back.
    # Later, the legal AI answer will be passed to TTS.
    return sse_response(
        transcript,
        lawyer["voice_id"],
    )
