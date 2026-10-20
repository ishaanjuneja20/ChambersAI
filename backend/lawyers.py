import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

LAWYERS = {
    "criminal": {
        "name": "Criminal Lawyer",
        "voice_id": "201388b52f4142fd962cfcc9b6f68e9b",
        "persona": "Confident, precise, and professional.",
    },
    "family": {
        "name": "Family Lawyer",
        "voice_id": "bdca24aa396b477eb77cfd20ca766cdf",
        "persona": "Calm, empathetic, and reassuring.",
    },
    "property": {
        "name": "Property Lawyer",
        "voice_id": "07d1a99304cc4e6c984bdbc1fdd87dde",
        "persona": "Clear, practical, and detail-oriented.",
    },
    # Ananya Iyer has no voice of her own yet: FISH_VOICE_CONSTITUTIONAL in backend/.env sets one;
    # until then she borrows the family lawyer's (female) voice.
    "constitutional": {
        "name": "Constitutional Lawyer",
        "voice_id": os.getenv("FISH_VOICE_CONSTITUTIONAL") or "bdca24aa396b477eb77cfd20ca766cdf",
        "persona": "Calm, precise, and thoughtful.",
    },
    # Karan Oberoi (male). Defaults to Fish's "Marcus authoritative and deep" (tagged male, calm,
    # professional), the criminal lawyer's voice; FISH_VOICE_LABOUR in backend/.env sets his own.
    "labour": {
        "name": "Labour Lawyer",
        "voice_id": os.getenv("FISH_VOICE_LABOUR") or "201388b52f4142fd962cfcc9b6f68e9b",
        "persona": "Firm, confident, and employee-focused.",
    },
    # Arjun Shah (male). Defaults to Fish's "Authoritative Male Speaker" (tagged male), distinct from
    # Karan's; FISH_VOICE_CONSUMER in backend/.env sets his own.
    "consumer": {
        "name": "Consumer Lawyer",
        "voice_id": os.getenv("FISH_VOICE_CONSUMER") or "07d1a99304cc4e6c984bdbc1fdd87dde",
        "persona": "Direct, practical, and consumer-focused.",
    },
}
