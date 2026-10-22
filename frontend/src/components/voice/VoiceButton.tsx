import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { resolveSpokenText, transcribeEnabled } from "../../lib/transcribeApi";
import { useVoiceInput } from "../../lib/useVoiceInput";
import { useLiveTranscript } from "./useLiveTranscript";
import VoiceBubble from "./VoiceBubble";
import "./VoiceBubble.css";

const TAP_THRESHOLD_MS = 280;

export interface VoiceButtonProps {
  /** Called with the recognized text once listening stops with something to send (never empty). With a backend this is the
   * transcript of the uploaded recording; the browser's own transcript is used only if the upload fails. */
  onResult: (text: string) => void;
  /** Host sets this true while awaiting a reply; the bubble stays visible in "Processing…" until it clears. */
  processing?: boolean;
  disabled?: boolean;
  /** Hold the Space bar to talk, same as holding the button. Ignored while a text field has focus. */
  enableSpaceBar?: boolean;
  /** "above" floats the bubble above the button (e.g. just above an input bar) instead of growing in place. */
  anchor?: "inline" | "above";
  /** Diameter of the idle mic button in px (default 44). */
  buttonSize?: number;
  /** "mic": render only the round mic button and report the live state through onUiChange (see VoiceUi). */
  variant?: "bubble" | "mic";
  onUiChange?: (ui: VoiceUi) => void;
  /** Draw your own trigger (e.g. a bar button) instead of the bubble / mic: it gets the same press handlers and the live state. */
  renderTrigger?: (trigger: VoiceTrigger) => React.ReactNode;
  label?: string;
  lang?: string;
  /** Optional: host can sync its own status (e.g. an avatar) to whether the mic is actively capturing. */
  onListeningChange?: (listening: boolean) => void;
  /** True from the moment recording stops until the transcript (or an error) is back. Hosts that run their own status
   * (Meet) show their "processing" state meanwhile; the bubble itself already does through `ui.transcribing`. */
  onTranscribingChange?: (transcribing: boolean) => void;
}

/** What the host needs to draw its own listening UI (the input bar's wave layer). */
export interface VoiceUi {
  expanded: boolean; // listening or processing
  mode: "listening" | "processing";
  transcript: string; // live caption preview (empty when the browser has no speech recognition)
  transcribing: boolean; // the recording is being turned into text by the backend
  error: string | null; // mic blocked, nothing recorded, or transcription failed
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
}

/** What a custom trigger needs from the voice button. */
export interface VoiceTrigger {
  onPointerDown: (e: React.PointerEvent) => void;
  /** Also ends a hold when the pointer is released (or leaves) after being pressed. */
  onPointerUp: (e: React.PointerEvent) => void;
  expanded: boolean; // listening or processing
  mode: "listening" | "processing";
  listening: boolean;
  disabled: boolean;
}

export interface VoiceButtonHandle {
  cancel: () => void;
  /** Starts hands-free listening if idle, or stops and sends if currently listening. For a
   * trigger other than this button itself (e.g. a separate tap-to-toggle control). */
  toggleHandsFree: () => void;
  /** Whether a hold started from a text field could start listening right now (voice supported, idle, not blocked). */
  canHold: () => boolean;
  /** Starts listening for a hold begun in a text field; the field (not the window Space handler) ends it with endHold. */
  beginHold: () => boolean;
  /** Ends a field-initiated hold: stops and reports the recognised text, like releasing the mic button. */
  endHold: () => void;
}

function isTypingTarget(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "TEXTAREA" || tag === "INPUT";
}

const VoiceButton = forwardRef<VoiceButtonHandle, VoiceButtonProps>(function VoiceButton(
  { onResult, processing = false, disabled = false, enableSpaceBar = true, anchor = "inline", buttonSize, variant = "bubble", onUiChange, renderTrigger, label = "Hold to talk", lang = "en-IN", onListeningChange, onTranscribingChange },
  ref,
) {
  const voice = useVoiceInput();
  const transcript = useLiveTranscript();
  const [transcribing, setTranscribing] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const transcribeRef = useRef<AbortController | null>(null); // the upload in flight; cancel / unmount aborts it
  const recordingRef = useRef({ startedAt: 0, peak: 0, raf: 0 }); // how long and how loud the current recording is (see isRecordingUsable)
  const startingRef = useRef<Promise<boolean> | null>(null); // the microphone is still starting (permission prompt): a release must wait for it

  const wasAlreadyListeningRef = useRef(false);
  const pressStartRef = useRef(0);
  const activeRef = useRef(false); // a listening session is open; makes finish / cancel idempotent so a result is never reported twice
  const fieldHoldRef = useRef(false); // a hold started in a text field owns the Space key until it is released
  const micBlockedRef = useRef(false);

  // Remember a blocked microphone, so holding Space in the text field doesn't swallow the space only to fail to start.
  useEffect(() => {
    let status: PermissionStatus | undefined;
    const update = () => (micBlockedRef.current = status?.state === "denied");
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((result) => {
        status = result;
        update();
        result.addEventListener("change", update);
      })
      .catch(() => {
        /* the Permissions API doesn't know "microphone" in every browser: then we simply can't tell */
      });
    return () => status?.removeEventListener("change", update);
  }, []);

  const listening = voice.status === "listening" || voice.status === "requesting";
  const busy = processing || transcribing;
  const expanded = listening || busy;
  const mode = busy ? "processing" : "listening";

  // Loudest sample the analyser sees while recording, 0..1. Read every frame; the mic is always on while this runs.
  const watchLevel = () => {
    const rec = recordingRef.current;
    rec.startedAt = performance.now();
    rec.peak = 0;
    let samples: Uint8Array<ArrayBuffer> | null = null;
    const tick = () => {
      const analyser = voice.analyserRef.current;
      if (analyser) {
        samples ??= new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(samples);
        for (const v of samples) rec.peak = Math.max(rec.peak, Math.abs(v - 128) / 128);
      }
      rec.raf = requestAnimationFrame(tick);
    };
    rec.raf = requestAnimationFrame(tick);
  };
  const stopWatchingLevel = () => cancelAnimationFrame(recordingRef.current.raf);

  const beginListening = async () => {
    if (disabled || listening || busy) return;
    activeRef.current = true;
    setSttError(null);
    transcript.start(lang);
    const starting = voice.start();
    startingRef.current = starting;
    const started = await starting;
    if (startingRef.current === starting) startingRef.current = null;
    if (!started) {
      // mic blocked, missing or unsupported: voice.error says why; there is nothing to listen to
      activeRef.current = false;
      transcript.cancel();
      return;
    }
    watchLevel();
    onListeningChange?.(true);
  };

  const finishListening = async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const browserText = transcript.stop();
    // Released before the microphone finished starting: wait for it, then stop it (otherwise it would start and stay on).
    if (startingRef.current && !(await startingRef.current)) return; // it never started; voice.error says why
    const blob = await voice.stop();
    stopWatchingLevel();
    const durationMs = performance.now() - recordingRef.current.startedAt;
    const peakLevel = recordingRef.current.peak;
    onListeningChange?.(false);

    const controller = new AbortController();
    transcribeRef.current = controller;
    if (transcribeEnabled) {
      setTranscribing(true); // demo mode has no upload to wait for: the browser transcript is used as it was
      onTranscribingChange?.(true);
    }
    let outcome;
    try {
      outcome = await resolveSpokenText({ blob, browserText, durationMs, peakLevel, signal: controller.signal });
    } catch {
      return; // cancelled while transcribing: cancelListening has already reset the state
    }
    if (transcribeRef.current !== controller) return;
    transcribeRef.current = null;
    if (transcribeEnabled) {
      setTranscribing(false);
      onTranscribingChange?.(false);
    }
    if ("error" in outcome) setSttError(outcome.error);
    else if (outcome.text) onResult(outcome.text);
  };

  const cancelListening = () => {
    activeRef.current = false;
    transcribeRef.current?.abort();
    transcribeRef.current = null;
    if (transcribing) {
      setTranscribing(false);
      onTranscribingChange?.(false);
    }
    setSttError(null);
    stopWatchingLevel();
    transcript.cancel();
    voice.cancel();
    onListeningChange?.(false);
  };

  useEffect(
    () => () => {
      transcribeRef.current?.abort();
      cancelAnimationFrame(recordingRef.current.raf);
    },
    [],
  );

  const toggleHandsFree = () => {
    if (listening) void finishListening();
    else void beginListening();
  };

  const canHold = () => !disabled && !busy && !listening && voice.supported && !micBlockedRef.current;
  const beginHold = () => {
    if (!canHold()) return false;
    fieldHoldRef.current = true;
    void beginListening();
    return true;
  };
  const endHold = () => {
    // Cleared a tick later: the window keyup handler below must still see the flag for this same key release.
    window.setTimeout(() => (fieldHoldRef.current = false), 0);
    void finishListening();
  };

  useImperativeHandle(ref, () => ({ cancel: cancelListening, toggleHandsFree, canHold, beginHold, endHold }));

  const unsupportedMessage = "Voice input isn't supported in this browser — type instead.";
  useEffect(() => {
    onUiChange?.({ expanded, mode, transcript: transcript.text, transcribing, error: voice.error ?? sttError ?? (voice.supported ? null : unsupportedMessage), analyserRef: voice.analyserRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, mode, transcript.text, transcribing, voice.error, sttError, voice.supported]);

  const onPressStart = () => {
    if (disabled || busy) return;
    if (listening) {
      wasAlreadyListeningRef.current = true;
      return;
    }
    wasAlreadyListeningRef.current = false;
    pressStartRef.current = Date.now();
    void beginListening();
  };

  const onPressEnd = () => {
    if (disabled || !listening) return;
    if (wasAlreadyListeningRef.current) {
      void finishListening();
      return;
    }
    const held = Date.now() - pressStartRef.current;
    if (held < TAP_THRESHOLD_MS) return; // quick tap from idle: stay listening (toggle on)
    void finishListening();
  };

  // Space bar: same hold-to-talk / tap-to-toggle semantics as the button, from anywhere on the
  // page except while typing. Esc always cancels.
  useEffect(() => {
    if (!enableSpaceBar) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && listening) {
        cancelListening();
        return;
      }
      if (e.code !== "Space" || isTypingTarget() || e.repeat || fieldHoldRef.current) return;
      e.preventDefault();
      onPressStart();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget() || fieldHoldRef.current) return;
      e.preventDefault();
      onPressEnd();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  if (renderTrigger) {
    return <>{renderTrigger({ onPointerDown: onPressStart, onPointerUp: onPressEnd, expanded, mode, listening: expanded && mode === "listening", disabled })}</>;
  }

  if (!voice.supported && variant !== "mic") {
    return <span className="voice-bubble-error">{unsupportedMessage}</span>;
  }

  return (
    <div>
      <VoiceBubble
        expanded={expanded}
        mode={mode}
        analyserRef={voice.analyserRef}
        transcriptPreview={transcript.text}
        label={label}
        anchor={anchor}
        buttonSize={buttonSize}
        variant={variant}
        disabled={disabled}
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onCancel={cancelListening}
      />
      {variant !== "mic" && (voice.error ?? sttError) && <p className="voice-bubble-error">{voice.error ?? sttError}</p>}
    </div>
  );
});

export default VoiceButton;
