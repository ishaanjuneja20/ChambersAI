# ChambersAI — frontend

Vite + React + TypeScript single-page app. Self-contained: can be deployed on Vercel with
`frontend` as the project root directory.

## Scope note

The rest of this repo (backend, docs, CLAUDE.md) assumed a frontend scaffold already existed on
an `origin/frontend` branch. It did not — that branch had only a README. This app was built from
scratch inside `frontend/` only; nothing outside this directory was touched.

## Setup

```bash
npm install
cp .env.example .env    # leave everything blank to run fully in demo mode
npm run dev
```

`npm run build` type-checks and produces `dist/`.

## Environment variables

| Variable | Effect when empty |
|---|---|
| `VITE_API_URL` | **Demo mode.** No backend is called; every screen runs on mock data in `src/lib/demoData.ts`. |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | No real auth; "Try a sample consultation" logs in a fake local user instead. |

The browser never calls Gemini or Fish Audio directly and never holds their keys — only this
backend's FastAPI and Supabase Auth.

## What's real vs. demo-only

The only backend endpoints that exist today (`backend/main.py` on the `deploy/oracle` branch) are
`GET /health`, `GET /lawyers`, and `POST /ask` (`{lawyer, question, lang}` →
`{answer, citations: string[], refused}`). `src/lib/api.ts` calls these for real when
`VITE_API_URL` is set.

Everything else this app's UI expects — matching a lawyer from free text, verified/interpretation/
no-source labels on citations, sessions, case summaries, document upload, timelines, evidence
checklists, draft generation — has **no backend endpoint yet**. Those calls are stubbed in demo
mode (`DEMO_MODE` in `src/lib/contract.ts`) and the screens that depend on them are visibly marked
"demo" in the UI. See "Changes needed outside frontend/" in the PR description for the proposed
contract.

## Layout

- `src/lib/contract.ts` — REAL vs PROPOSED backend types, `DEMO_MODE` flag.
- `src/lib/api.ts` — calls the real backend when configured, falls back to demo data.
- `src/lib/demoData.ts` — mock lawyers, answers, citations, sessions, facts.
- `src/lib/sessionsStore.ts` — demo "My Consultations" history, persisted to `localStorage`.
- `src/lib/auth.ts`, `src/context/AuthContext.tsx` — Supabase Auth, or a fake demo user when unset.
- `src/components/Avatar.tsx` — stable interface (`lawyer`, `audioSource`/`audioLevel`, `status`);
  lipsync is a loudness-driven mouth overlay, see "Avatar" below.
- `src/pages/*` — one file per screen (see tiers below).

## Avatar / lipsync

The brief asked to check whether `talking-avatar.dev` offers a real-time lip-sync SDK. It does:
`@interviewflowai/talking-avatar` (npm, MIT, first published 2026-10-09) exposes an `attachStream()`
API that drives a 3D `.glb` avatar from a live `MediaStream`. It was **not** used here: it's a
brand-new, low-adoption package, it needs a `.glb` avatar asset we don't have (the "realistic
Indian lawyer avatar" reference image was not available either), and pulling in new 3D-asset
tooling this late is exactly the kind of risk the hackathon-pace rule says to avoid. Instead,
`src/lib/useAudioLevel.ts` reads RMS loudness from a `<audio>` element or `MediaStream` via the Web
Audio API, and `Avatar.tsx` uses it to drive a simple mouth-open overlay on the placeholder SVG
portrait (`public/avatars/placeholder.svg`). Swapping in a real portrait/idle/greeting clip from
talking-avatar.dev's pre-rendered side, or revisiting the real-time SDK later, doesn't require
changing the `Avatar` component's interface.

## Screens built

**Tier 1 (fully wired, demo-complete):** login/signup + Google + sample consultation, home
(text/voice problem description, quiet domain shortcuts), lawyer recommendation (+ "choose
another lawyer"), consultation page (avatar, transcript, push-to-talk, status, stop, handoff
banner), source-backed answers (verified / interpretation / no-source badges), privacy & delete
conversations.

**Tier 2:** My Consultations (search, reopen, delete one/all — `localStorage`-backed), Case
Summary, Next Steps (in the Case Intelligence panel), Profile & Settings, Hindi/English toggle
(UI + `language` field only — shows "not available in demo" for Hindi answers).

**Tier 3 (UI only, explicitly marked, no backend wiring):** document upload with canned extracted
facts (editable, flagged missing/contradictory), Case Intelligence panel's Timeline and Evidence
Checklist tabs. Draft generation (complaint/notice) was not built — it was the last item in the
priority list and Tier 1 was prioritized per the hackathon-pace rule; it can be added as another
demo-marked tab in the Case Intelligence panel following the same pattern as Timeline/Evidence.
