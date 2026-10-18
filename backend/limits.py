"""Public-demo protections, kept free of FastAPI so they can be unit-tested anywhere.

- RateLimiter: per-visitor and global questions per minute, so one visitor cannot burn the Gemini quota
  (one question = 3-4 Gemini calls; the free key allows 15 calls a minute per model).
- client_ip: the visitor's address. Behind the Cloudflare tunnel every request comes from the tunnel process on
  localhost, so the real address is only in CF-Connecting-IP / X-Forwarded-For; those headers are believed only when
  CHAMBERS_TRUST_PROXY=1 (set by deploy/start_local.sh), never when the server is reached directly.
- check_question: length cap and non-empty check. Nothing here ever logs the question text.
"""
from __future__ import annotations

import collections
import time

MAX_QUESTION_CHARS = 600
WINDOW = 60.0


class RateLimiter:
    def __init__(self, per_visitor: int = 10, overall: int = 0, clock=time.time):
        self.per_visitor, self.overall, self.clock = per_visitor, overall, clock
        self._by_ip: dict[str, list[float]] = collections.defaultdict(list)
        self._all: list[float] = []

    def allow(self, ip: str) -> bool:
        """Record one question from `ip`; False when it is over a limit (the question is then not recorded)."""
        now = self.clock()
        self._all = [t for t in self._all if now - t < WINDOW]
        mine = [t for t in self._by_ip.get(ip, []) if now - t < WINDOW]
        if self.per_visitor and len(mine) >= self.per_visitor:
            self._by_ip[ip] = mine
            return False
        if self.overall and len(self._all) >= self.overall:
            self._by_ip[ip] = mine
            return False
        mine.append(now)
        self._all.append(now)
        self._by_ip[ip] = mine
        if len(self._by_ip) > 5000:                                   # forget visitors that have gone quiet
            for k in [k for k, v in self._by_ip.items() if not v or now - v[-1] >= WINDOW]:
                del self._by_ip[k]
        return True


def client_ip(headers, client_host: str | None, trust_proxy: bool) -> str:
    if trust_proxy:
        for name in ("cf-connecting-ip", "x-forwarded-for"):
            v = (headers.get(name) or "").split(",")[0].strip()
            if v:
                return v
    return client_host or "?"


def check_question(question: str, max_chars: int = MAX_QUESTION_CHARS) -> tuple[int, str] | None:
    """None when fine, else (http status, message)."""
    if not question or not question.strip():
        return 422, "the question is empty"
    if len(question) > max_chars:
        return 413, f"the question is too long (max {max_chars} characters)"
    return None
