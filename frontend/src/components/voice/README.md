# Voice bubble

Every mic button in the app must be `<VoiceButton />` from this folder — never a plain `<button>`
wired to `getUserMedia`/`SpeechRecognition` directly. It owns one microphone/analyser source per
instance, morphs itself from a small mic button into a living glass bubble while listening, and
shrinks back when done. The animation inside the bubble (drifting colour blobs + flowing ribbons)
never touches the rest of the page — no dimming, no overlay, no page-wide effect.

## Usage

```tsx
import VoiceButton from "../components/voice/VoiceButton";

<VoiceButton
  onResult={(text) => setQuestion((prev) => (prev ? `${prev} ${text}` : text))}
/>
```

### Props

| Prop | Default | What it does |
|---|---|---|
| `onResult(text)` | required | Called once listening stops with recognized speech to send. |
| `processing` | `false` | Set `true` while awaiting a reply — the bubble stays visible ("Processing…") until you clear it. |
| `disabled` | `false` | Disables the button entirely. |
| `enableSpaceBar` | `true` | Hold Space to talk too (ignored while a text field has focus). |
| `anchor` | `"inline"` | `"above"` floats the bubble above the button instead of growing in place — use this when the button sits in a tight input bar (see `Meet.tsx`). Wrap the button in a `position: relative` container when using `"above"`. |
| `label` | `"Hold to talk"` | Idle button's `aria-label`. |
| `lang` | `"en-IN"` | BCP-47 language tag for `SpeechRecognition`. |
| `onListeningChange(listening)` | — | Optional: sync a host page's own status (e.g. an avatar's "Listening" ring) to the mic's actual capture state. |

### Interaction model

- **Hold-to-talk**: press and hold the button (mouse/touch) or Space, release to stop and send.
- **Tap-to-toggle**: a quick tap starts listening and keeps it on; tap again (or hold Space again)
  to stop and send.
- **Esc** cancels at any time — discards what was said, releases the mic, no `onResult` call.
- The small "×" on the bubble does the same as Esc.

### Imperative cancel

If a page needs to interrupt listening from elsewhere (e.g. a "Stop" button), attach a ref:

```tsx
const voiceRef = useRef<VoiceButtonHandle>(null);
<VoiceButton ref={voiceRef} onResult={...} />
// elsewhere:
voiceRef.current?.cancel();
```

## Architecture

- `frontend/src/lib/useVoiceInput.ts` — owns `getUserMedia` + `MediaRecorder` (webm/opus) +
  a Web Audio `AnalyserNode`. Exposes `analyserRef` (a ref, not state) so the canvas loop can
  read live level/frequency data every frame without re-rendering React. Handles
  permission-denied / no-mic / unsupported-browser with a human message. `stop()`/`cancel()`
  release the mic and all tracks immediately — nothing is ever kept beyond the call.
- `frontend/src/components/voice/useLiveTranscript.ts` — optional `SpeechRecognition` wrapper for
  the live "last few words" caption. Purely additive; everything works without it.
- `frontend/src/components/voice/bubbleCanvas.ts` — the actual drawing: 3-4 drifting blobs
  (additive radial gradients) + 4 flowing ribbons (multi-sine + slow value-noise), driven by a
  continuously increasing `t`, reactive to a smoothed voice level and frequency bands.
- `frontend/src/components/voice/VoiceBubble.tsx` — presentational: the mic-button ↔ bubble morph
  (`framer-motion`, <350ms spring), the glass CSS, the canvas `requestAnimationFrame` loop
  (paused when the tab is hidden), and the reduced-motion fallback (static glass, glow brightness
  only, no shape/flow motion).
- `frontend/src/components/voice/VoiceButton.tsx` — the smart component: hold/tap state machine,
  Space bar, Esc, wires `useVoiceInput` + `useLiveTranscript` into `VoiceBubble`.

## Adding a mic button to a future page

Just render `<VoiceButton onResult={...} />`. Don't build a new mic/analyser hook, a new morph
animation, or a new canvas — reuse this system so every mic in the app looks and behaves
identically. If a future screen needs the bubble to anchor above a fixed input bar instead of
growing in place, pass `anchor="above"` and wrap it in a `position: relative` container, same as
`Meet.tsx` does.
