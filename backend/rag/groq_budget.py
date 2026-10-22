"""A proactive Groq budget: stay under Groq's per-minute limits by making a NEW question wait for room instead of letting it
hit a 429 and fall back to Gemini (whose free tier can hang for 30 s and more).

Per Groq model, over a rolling 60 s window, it counts the tokens used (usage.total_tokens of each response) and the questions
that used the model. A question is one user question: it is counted once, on its first call to a model, and all its calls
(rewrite, answer, retry, general guidance) add their tokens. When a new question arrives and the budget is used up
(GROQ_QUESTIONS_PER_MIN questions or GROQ_TOKENS_PER_MIN tokens in the window) it waits until the oldest counted question or
tokens leave the window, if that takes at most GROQ_MAX_WAIT seconds; if it takes longer the question goes straight to the
Gemini rotation. A question already counted keeps using Groq whatever the budget says. CHAMBERS_GROQ_BUDGET=0 turns it all off.

This module holds the windows and the per-question ticket; generate.py decides which model a question would use and does the
waiting (generate.admit_steps), because it knows the model order, the 429 skips and the fake clocks of its tests.
"""
from __future__ import annotations
import collections
import contextlib
import contextvars
import os
import sys
import threading
import time

WINDOW = 60.0                    # seconds a question or a token count stays in the budget
DEFAULT_QUESTIONS = 2            # per window, per model
DEFAULT_TOKENS = 7000            # per window, per model (Groq's own limit is 8000 on the free tier)
DEFAULT_MAX_WAIT = 15.0          # seconds a new question may wait for room before going to Gemini
STEP = 0.5                       # seconds per sleep while waiting
KEEPALIVE_EVERY = 3.0            # seconds between the keep-alives sent to an open stream while it waits
MIN_WAIT = 0.01

_lock = threading.Lock()
_questions: dict[str, collections.deque] = {}        # model -> times at which a question first used it
_tokens: dict[str, collections.deque] = {}           # model -> (time, tokens) of each response


def enabled() -> bool:
    return os.environ.get("CHAMBERS_GROQ_BUDGET", "1") != "0"


def _number(name: str, default: float, cast=float) -> float:
    try:
        value = cast(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def max_questions() -> int:
    return int(_number("GROQ_QUESTIONS_PER_MIN", DEFAULT_QUESTIONS, int))


def max_tokens() -> int:
    return int(_number("GROQ_TOKENS_PER_MIN", DEFAULT_TOKENS, int))


def max_wait() -> float:
    return _number("GROQ_MAX_WAIT", DEFAULT_MAX_WAIT)


def reset() -> None:
    with _lock:
        _questions.clear()
        _tokens.clear()


def trace(message: str) -> None:
    """CHAMBERS_TRACE=1: one line on stderr. Never any question text or key."""
    if os.environ.get("CHAMBERS_TRACE"):
        print(f"[llm] {message}", file=sys.stderr, flush=True)


class Ticket:
    """One user question. `admitted` is set once the budget has been looked at (or does not apply); `skip` when the wait would
    be too long, so every Groq call of the question is refused and the Gemini rotation takes over; `models` are the Groq
    models the question has been counted on."""

    def __init__(self):
        self.lock = threading.Lock()          # one thread at a time does the admission (the two rewrites run in parallel)
        self.admitted = False
        self.skip = False
        self.models: set[str] = set()


_current: contextvars.ContextVar[Ticket | None] = contextvars.ContextVar("groq_ticket", default=None)


def current() -> Ticket | None:
    return _current.get()


@contextlib.contextmanager
def bound(ticket: Ticket):
    token = _current.set(ticket)
    try:
        yield ticket
    finally:
        _current.reset(token)


@contextlib.contextmanager
def scope():
    """The ticket of the question being answered: the one already bound (the stream endpoints admit it first), else a new one."""
    with bound(current() or Ticket()) as ticket:
        yield ticket


def bind_iter(ticket: Ticket, it):
    """Iterate `it` with `ticket` bound during every step. A generator served by a thread pool is resumed in a fresh context
    each time, so the ticket cannot simply be set once."""
    it = iter(it)
    try:
        while True:
            with bound(ticket):
                try:
                    item = next(it)
                except StopIteration:
                    return
            yield item
    finally:
        with bound(ticket):
            getattr(it, "close", lambda: None)()          # the consumer stopped early: close the stream it was reading


def carry(fn):
    """`fn` run in a copy of the current context, for a worker thread (a context cannot be entered by two threads at once,
    so call this once per submit)."""
    ctx = contextvars.copy_context()
    return lambda *a, **k: ctx.run(fn, *a, **k)


def _prune(model: str, now: float) -> None:
    q, t = _questions.get(model), _tokens.get(model)
    while q and now - q[0] >= WINDOW:
        q.popleft()
    while t and now - t[0][0] >= WINDOW:
        t.popleft()


def reserve(model: str, ticket: Ticket) -> float:
    """Count the question on `model` if there is room: returns 0. Otherwise returns the seconds until the oldest counted
    question or tokens have left the window enough for it to fit (never 0). Check and count are one step under the lock, so
    questions arriving together cannot both take the last place."""
    limit_q, limit_t = max_questions(), max_tokens()
    with _lock:
        now = time.time()
        _prune(model, now)
        q = _questions.setdefault(model, collections.deque())
        t = _tokens.setdefault(model, collections.deque())
        used = sum(n for _, n in t)
        if len(q) < limit_q and used < limit_t:
            q.append(now)
            ticket.models.add(model)
            return 0.0
        wait = 0.0
        if len(q) >= limit_q:                              # the (len - limit + 1)th oldest question must leave
            wait = q[len(q) - limit_q] + WINDOW - now
        if used >= limit_t:                                # tokens must drop under the limit: oldest responses leave first
            for at, n in t:
                used -= n
                if used < limit_t:
                    wait = max(wait, at + WINDOW - now)
                    break
        return max(wait, MIN_WAIT)


def count_question(model: str, ticket: Ticket) -> None:
    """A question already admitted first uses another model (the first one failed): counted there, no waiting."""
    with _lock:
        if model in ticket.models:
            return
        ticket.models.add(model)
        _questions.setdefault(model, collections.deque()).append(time.time())


def add_tokens(model: str, usage) -> None:
    """The tokens of one Groq response, from its usage.total_tokens."""
    total = usage.get("total_tokens") if isinstance(usage, dict) else None
    if isinstance(total, int) and total > 0:
        with _lock:
            _tokens.setdefault(model, collections.deque()).append((time.time(), total))
