# ChambersAI — frontend

Vite + React + TypeScript. Self-contained: deployable on Vercel with `frontend` as the project
root directory.

## Setup

```bash
npm install
npm run dev
```

`npm run build` type-checks and produces `dist/`.

## Status

Step 1 only: the session intro animation (logo wipe + band "AI" drop-in) and a placeholder
screen with a "Replay intro" button. No routing, no auth, no backend calls yet — those are later
steps.

## Brand asset

`public/brand/logo-white.png` is the untouched source wordmark (white on transparent — only use
it on the dark purple `--chambers-deep` background). `IntroSplash.tsx` never redraws it; it only
clips two stacked copies of the same file with CSS `clip-path` at the seam between "Chambers" and
the band "AI" (≈78.3% of the image width, found from the PNG's alpha channel) and animates those
clip windows plus opacity/position.
