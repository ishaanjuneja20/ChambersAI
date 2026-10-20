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
  label?: string;
  lang?: string;
  /** Optional: host can sync its own status (e.g. an avatar) to whether the mic is actively capturing. */
  onListeningChange?: (listening: boolean) => void;
}

export interface VoiceButtonHandle {
  cancel: () => void;
  /** Starts hands-free listening if idle, or stops and sends if currently listening. For a
   * trigger other than this button itself (e.g. a separate tap-to-toggle control). */
  toggleHandsFree: () => void;
}

function isTypingTarget(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "TEXTAREA" || tag === "INPUT";
}

const VoiceButton = forwardRef<VoiceButtonHandle, VoiceButtonProps>(function VoiceButton(
  { onResult, processing = false, disabled = false, enableSpaceBar = true, anchor = "inline", label = "Hold to talk", lang = "en-IN", onListeningChange },
  ref,
) {
  const voice = useVoiceInput();
  const transcript = useLiveTranscript();

  const wasAlreadyListeningRef = useRef(false);
  const pressStartRef = useRef(0);

  const listening = voice.status === "listening" || voice.status === "requesting";
  const expanded = listening || processing;
  const mode = processing ? "processing" : "listening";

  const beginListening = async () => {
    if (disabled || listening || processing) return;
    transcript.start(lang);
    await voice.start();
    onListeningChange?.(true);
  };

  const finishListening = async () => {
    const spokenText = transcript.stop();
    await voice.stop();
    onListeningChange?.(false);
    if (spokenText) onResult(spokenText);
  };

  const cancelListening = () => {
    transcript.cancel();
    voice.cancel();
    onListeningChange?.(false);
  };

  const toggleHandsFree = () => {
    if (listening) void finishListening();
    else void beginListening();
  };

  useImperativeHandle(ref, () => ({ cancel: cancelListening, toggleHandsFree }));

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
      if (e.code !== "Space" || isTypingTarget() || e.repeat) return;
      e.preventDefault();
      onPressStart();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget()) return;
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

  if (!voice.supported) {
    return <span className="voice-bubble-error">Voice input isn't supported in this browser — type instead.</span>;
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
        onPointerDown={onPressStart}
        onPointerUp={onPressEnd}
        onCancel={cancelListening}
      />
      {voice.error && <p className="voice-bubble-error">{voice.error}</p>}
    </div>
  );
});

export default VoiceButton;
