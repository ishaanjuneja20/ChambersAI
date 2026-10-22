import base64
import json
import logging
import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.docs_routes import build_router as build_docs_router
from backend.lawyers import LAWYERS as VOICE_LAWYERS
from backend.rag.generate import GenerationError
from backend.rag.pipeline import answer, answer_stream, sse_lines, warmup

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# The voice modules need FISH_API_KEY / GROQ_API_KEY in backend/.env and raise at import without them.
# Load them softly so /ask and /ask/stream still run without voice keys; the voice endpoints return 503.
try:
    from backend.audio_handler import stream_tts_sentence, tts_with_timestamps
    from backend.stt_service import transcribe_audio_with_metadata
    VOICE_ERROR = None
except RuntimeError as e:
    stream_tts_sentence = tts_with_timestamps = transcribe_audio_with_metadata = None
    VOICE_ERROR = str(e)
    logger.warning("Voice endpoints disabled: %s", VOICE_ERROR)

app = FastAPI(title="ChambersAI")
LAWYERS = json.loads((Path(__file__).parent.parent / "lawyers.json").read_text())

# The browser app calls /api/speak directly; list its origins (comma-separated) in CHAMBERS_CORS_ORIGINS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get(
        "CHAMBERS_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

# Uploaded PDFs and questions about them (docs/CONTRACTS.md, "Document analysis").
app.include_router(build_docs_router(LAWYERS))

MAX_AUDIO_BYTES = 15 * 1024 * 1024
MAX_SPEAK_CHARS = 1000

LawyerID = Literal["criminal", "family", "property"]


class AskRequest(BaseModel):
    lawyer: str
    question: str
    lang: Optional[str] = None      # "en" | "hi"; detected from the question when omitted
    voice: bool = True              # /ask/stream only: ask for a short answer that sounds right when spoken


class SpeakRequest(BaseModel):
    text: str                       # one sentence (or a few), exactly as it should be spoken
    lawyer_id: str
    lang: Optional[Literal["en", "hi"]] = None   # passed to Fish for normalisation and alignment


@app.on_event("startup")
def _warm():
    if os.environ.get("CHAMBERS_WARMUP", "1") != "0":
        warmup()


# --------------------------------------------------
# 1. ROOT / HEALTH
# --------------------------------------------------

@app.get("/")
async def root():
    return {
        "status": "online",
        "message": "ChambersAI Backend is running!",
    }


@app.get("/health")
def health():
    return {"ok": True}


# --------------------------------------------------
# 2. LAWYERS
# --------------------------------------------------

@app.get("/lawyers")
def lawyers():
    return LAWYERS


@app.get("/api/lawyers")
async def list_lawyers():
    return [
        {
            "id": lawyer_id,
            "name": config["name"],
            "persona": config["persona"],
        }
        for lawyer_id, config in VOICE_LAWYERS.items()
    ]


def get_lawyer_config(lawyer_id: str) -> dict:
    lawyer = VOICE_LAWYERS.get(lawyer_id)

    if not lawyer:
        raise HTTPException(
            status_code=400,
            detail="Invalid lawyer ID.",
        )

    return lawyer


# --------------------------------------------------
# 3. RAG: ASK
# --------------------------------------------------

@app.post("/ask")
def ask(req: AskRequest):
    lawyer = next((l for l in LAWYERS if l["id"] == req.lawyer), None)
    if lawyer is None:
        raise HTTPException(404, "unknown lawyer")
    try:
        return answer(req.question, lawyer, req.lang)
    except GenerationError as e:
        raise HTTPException(503, str(e))


@app.post("/ask/stream")
def ask_stream(req: AskRequest):
    """Server-sent events, one JSON object per `data:` line: sentence / done / refused / error (see docs/CONTRACTS.md)."""
    lawyer = next((l for l in LAWYERS if l["id"] == req.lawyer), None)
    if lawyer is None:
        raise HTTPException(404, "unknown lawyer")

    def events():
        yield from sse_lines(lambda: answer_stream(req.question, lawyer, req.lang, voice=req.voice))

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# --------------------------------------------------
# 4. READ AND VALIDATE AUDIO
# --------------------------------------------------

def require_voice():
    if VOICE_ERROR:
        raise HTTPException(
            status_code=503,
            detail="Voice is not configured on this server.",
        )


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
# 5. SHARED WHISPER TRANSCRIPTION
# --------------------------------------------------

async def transcribe_uploaded_file(
    audio_file: UploadFile,
    language: str | None = None,
) -> dict:
    require_voice()

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
# 6. TEST STT
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
# 7. FRONTEND STT ENDPOINT
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
# 8. FISH AUDIO STREAMING
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
    require_voice()

    return StreamingResponse(
        audio_sse_generator(text, voice_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# --------------------------------------------------
# 9. TEST TTS
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
# 10. SPEECH + WORD TIMESTAMPS (LIP-SYNC)
# --------------------------------------------------

@app.post("/api/speak")
async def speak(req: SpeakRequest):
    """MP3 for the text plus Fish Audio's word timestamps for that exact audio (see docs/CONTRACTS.md)."""
    require_voice()

    text = req.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text cannot be empty.",
        )

    if len(text) > MAX_SPEAK_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text exceeds the {MAX_SPEAK_CHARS}-character limit.",
        )

    lawyer = get_lawyer_config(req.lawyer_id)
    result = await tts_with_timestamps(text, lawyer["voice_id"], req.lang)

    if not result["audio"]:
        raise HTTPException(
            status_code=502,
            detail="Speech generation returned no audio.",
        )

    segments = result["segments"]

    return {
        "audio_base64": base64.b64encode(result["audio"]).decode("ascii"),
        "format": "mp3",
        "timing": {
            "source": "fish-timestamps" if segments else "none",
            "segments": segments,
        },
    }


# --------------------------------------------------
# 11. TEST STT + TTS LOOPBACK
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
