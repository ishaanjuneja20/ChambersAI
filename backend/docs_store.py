"""Uploaded PDFs, per session: validation, text extraction, encrypted storage with a time limit.

Privacy (CLAUDE.md rule 6): the extracted text, the file name and the analysis are encrypted (Fernet) before they are
kept, and they are kept in server MEMORY only: nothing is written to disk, and everything is gone after DOCS_TTL
(24 h) or when the server restarts. The key comes from DOCS_ENCRYPTION_KEY; without it an ephemeral key is generated at
startup, so nothing stored could be read after a restart even if it survived. Document text and file names are never
logged: log lines carry the short document id and counts only.

Generate a key with:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import secrets
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass

from cryptography.fernet import Fernet, InvalidToken
from pypdf import PdfReader

logger = logging.getLogger(__name__)

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 60
MAX_DOCS_PER_SESSION = 3
TTL_SECONDS = 24 * 60 * 60
MIN_TEXT_CHARS = 80               # fewer letters than this in the whole PDF = scanned / image only
SCANNED_MESSAGE = "This looks like a scanned PDF. Only text PDFs are supported."
SESSION_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


class DocError(Exception):
    """A request the user can fix. `status` is the HTTP status to answer with, `message` is safe to show."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def valid_session_id(session_id: str) -> bool:
    return SESSION_ID.fullmatch(session_id) is not None


def clean_filename(name: str | None) -> str:
    name = (name or "document.pdf").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip()
    return name[:120] or "document.pdf"


def _clean_text(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_pdf(data: bytes) -> list[str]:
    """Validate a PDF and return the text of each page. Raises DocError (413 too big, 400 not a PDF, 422 unreadable,
    password protected, too many pages or scanned)."""
    if len(data) > MAX_BYTES:
        raise DocError(413, "The file is larger than 10 MB.")
    if not data.startswith(b"%PDF"):
        raise DocError(400, "Only PDF files are supported.")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise DocError(422, "This PDF is password protected. Remove the password and upload it again.")
        count = len(reader.pages)
        if count > MAX_PAGES:
            raise DocError(422, f"The PDF has more than {MAX_PAGES} pages.")
        pages = [_clean_text(page.extract_text() or "") for page in reader.pages]
    except DocError:
        raise
    except Exception as e:                      # damaged or unusual file; the reason may quote its content, so only the type is logged
        logger.warning("PDF could not be read (%s)", type(e).__name__)
        raise DocError(422, "This PDF could not be read.") from None
    if count == 0 or sum(ch.isalpha() for page in pages for ch in page) < MIN_TEXT_CHARS:
        raise DocError(422, SCANNED_MESSAGE)
    return pages


@dataclass
class _Entry:
    token: bytes          # Fernet token of the JSON {filename, pages, analysis}
    created: float
    page_count: int


class DocStore:
    def __init__(self, key: str | bytes | None = None, clock=time.time, ttl: float = TTL_SECONDS, max_docs: int = MAX_DOCS_PER_SESSION):
        key = key or os.environ.get("DOCS_ENCRYPTION_KEY")
        if not key:
            key = Fernet.generate_key()
            logger.warning("DOCS_ENCRYPTION_KEY is not set: using an ephemeral key. Uploaded documents are held in memory "
                           "only and are lost when the server restarts.")
        try:
            self._fernet = Fernet(key)
        except (ValueError, TypeError):
            raise RuntimeError("DOCS_ENCRYPTION_KEY is not a valid Fernet key (32 url-safe base64 bytes)") from None
        self._clock = clock
        self._ttl = ttl
        self._max = max_docs
        self._docs: dict[str, dict[str, _Entry]] = {}
        self._pending: dict[str, int] = {}
        self._lock = threading.Lock()

    # ---- time limit
    def purge(self) -> None:
        """Drop every document older than the TTL (called on each use)."""
        now = self._clock()
        with self._lock:
            for session_id in list(self._docs):
                docs = self._docs[session_id]
                for doc_id in [d for d, e in docs.items() if now - e.created >= self._ttl]:
                    del docs[doc_id]
                if not docs:
                    del self._docs[session_id]

    # ---- limits
    @contextmanager
    def slot(self, session_id: str):
        """Holds one of the session's document places while an upload is being analysed (so two uploads at once cannot
        both pass the limit). Raises DocError(409) when the session is full."""
        self.purge()
        with self._lock:
            if len(self._docs.get(session_id, {})) + self._pending.get(session_id, 0) >= self._max:
                raise DocError(409, f"You can attach up to {self._max} documents to a consultation.")
            self._pending[session_id] = self._pending.get(session_id, 0) + 1
        try:
            yield
        finally:
            with self._lock:
                self._pending[session_id] -= 1
                if not self._pending[session_id]:
                    del self._pending[session_id]

    # ---- storage
    def add(self, session_id: str, filename: str, pages: list[str], analysis: dict) -> str:
        payload = json.dumps({"filename": filename, "pages": pages, "analysis": analysis}, ensure_ascii=False).encode()
        entry = _Entry(self._fernet.encrypt(payload), self._clock(), len(pages))
        doc_id = secrets.token_hex(6)
        with self._lock:
            self._docs.setdefault(session_id, {})[doc_id] = entry
        logger.info("document stored id=%s pages=%d", doc_id, len(pages))
        return doc_id

    def _open(self, doc_id: str, entry: _Entry) -> dict | None:
        try:
            data = json.loads(self._fernet.decrypt(entry.token))
        except (InvalidToken, ValueError):
            return None
        data["doc_id"] = doc_id
        return data

    def list_session(self, session_id: str) -> list[dict]:
        """The session's documents, oldest first, decrypted: {doc_id, filename, pages: [text per page], analysis}."""
        self.purge()
        with self._lock:
            entries = list(self._docs.get(session_id, {}).items())
        return [d for d in (self._open(i, e) for i, e in entries) if d is not None]

    def has_docs(self, session_id: str) -> bool:
        self.purge()
        with self._lock:
            return bool(self._docs.get(session_id))

    def delete(self, session_id: str, doc_id: str) -> bool:
        self.purge()
        with self._lock:
            docs = self._docs.get(session_id, {})
            found = docs.pop(doc_id, None) is not None
            if session_id in self._docs and not docs:
                del self._docs[session_id]
        if found:
            logger.info("document deleted id=%s", doc_id)
        return found

    def raw_tokens(self) -> list[bytes]:
        """What is actually held in memory (for the encryption test)."""
        with self._lock:
            return [e.token for docs in self._docs.values() for e in docs.values()]


_store: DocStore | None = None


def get_store() -> DocStore:
    global _store
    if _store is None:
        _store = DocStore()
    return _store


def set_store(store: DocStore | None) -> None:
    """For tests."""
    global _store
    _store = store
