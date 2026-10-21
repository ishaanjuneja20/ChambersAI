import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useVoiceInput } from "../../lib/useVoiceInput";
import { useLiveTranscript } from "./useLiveTranscript";
import VoiceBubble from "./VoiceBubble";
import "./VoiceBubble.css";

const TAP_THRESHOLD_MS = 280;

export interface VoiceButtonProps {
  /** Called with the recognized text once listening stops with something to send. */
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
}

/** What the host needs to draw its own listening UI (the input bar's wave layer). */
export interface VoiceUi {
  expanded: boolean; // listening or processing
  mode: "listening" | "processing";
  transcript: string; // live caption preview (empty when the browser has no speech recognition)
  error: string | null;
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
  { onResult, processing = false, disabled = false, enableSpaceBar = true, anchor = "inline", buttonSize, variant = "bubble", onUiChange, renderTrigger, label = "Hold to talk", lang = "en-IN", onListeningChange },
  ref,
) {
  const voice = useVoiceInput();
  const transcript = useLiveTranscript();

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
  const expanded = listening || processing;
  const mode = processing ? "processing" : "listening";

  const beginListening = async () => {
    if (disabled || listening || processing) return;
    activeRef.current = true;
    transcript.start(lang);
    await voice.start();
    onListeningChange?.(true);
  };

  const finishListening = async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    const spokenText = transcript.stop();
    await voice.stop();
    onListeningChange?.(false);
    if (spokenText) onResult(spokenText);
  };

  const cancelListening = () => {
    activeRef.current = false;
    transcript.cancel();
    voice.cancel();
    onListeningChange?.(false);
  };

  const toggleHandsFree = () => {
    if (listening) void finishListening();
    else void beginListening();
  };

  const canHold = () => !disabled && !processing && !listening && voice.supported && !micBlockedRef.current;
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
    onUiChange?.({ expanded, mode, transcript: transcript.text, error: voice.error ?? (voice.supported ? null : unsupportedMessage), analyserRef: voice.analyserRef });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, mode, transcript.text, voice.error, voice.supported]);

  const onPressStart = () => {
    if (disabled || processing) return;
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
      {variant !== "mic" && voice.error && <p className="voice-bubble-error">{voice.error}</p>}
    </div>
  );
});

export default VoiceButton;
