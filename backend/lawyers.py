import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

LAWYERS = {
    # Rhea Kapoor (female). Defaults to her own female Fish voice; FISH_VOICE_CRIMINAL in backend/.env overrides it.
    "criminal": {
        "name": "Criminal Lawyer",
        "voice_id": os.getenv("FISH_VOICE_CRIMINAL") or "b1a1d760d9604bdb957a56eec3460f1b",
        "persona": "Confident, precise, and professional.",
    },
    # Meera Iyer (female).
    "family": {
        "name": "Family Lawyer",
        "voice_id": "06ad9402213e4e7189cb5a298f9ba821",
        "persona": "Calm, empathetic, and reassuring.",
    },
    # Priya Menon (female).
    "property": {
        "name": "Property Lawyer",
        "voice_id": "fa3528ac39d546429da5f65612df7b4c",
        "persona": "Clear, practical, and detail-oriented.",
    },
    # Ananya Iyer (female). Defaults to her own female Fish voice; FISH_VOICE_CONSTITUTIONAL in backend/.env overrides it.
    "constitutional": {
        "name": "Constitutional Lawyer",
        "voice_id": os.getenv("FISH_VOICE_CONSTITUTIONAL") or "a6630e2dd6c14ea799c2a7c078e0d8de",
        "persona": "Calm, precise, and thoughtful.",
    },
    # Karan Oberoi (male). Defaults to his own male Fish voice; FISH_VOICE_LABOUR in backend/.env overrides it.
    "labour": {
        "name": "Labour Lawyer",
        "voice_id": os.getenv("FISH_VOICE_LABOUR") or "ce9c96291460478ea6851049cb847d73",
        "persona": "Firm, confident, and employee-focused.",
    },
    # Arjun Shah (male). Defaults to his own male Fish voice; FISH_VOICE_CONSUMER in backend/.env overrides it.
    "consumer": {
        "name": "Consumer Lawyer",
        "voice_id": os.getenv("FISH_VOICE_CONSUMER") or "73770ea2927d46c19e461e7e812b2f95",
        "persona": "Direct, practical, and consumer-focused.",
    },
}
