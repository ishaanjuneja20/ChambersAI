import { useEffect, useRef, useState } from "react";
import { Plus, X, ArrowUp, Square } from "lucide-react";
import AttachmentChips from "./AttachmentChips";
import { ALLOWED_EXTENSIONS, useAttachments } from "../lib/attachments";
import { useMediaQuery } from "../hooks/useMediaQuery";
import VoiceButton, { type VoiceButtonHandle, type VoiceUi } from "./voice/VoiceButton";
import VoiceWaveBar from "./voice/VoiceWaveBar";
import type { ConsultStatus } from "../lib/consultTypes";
import "./MeetInputBar.css";

// Holding Space in the text field for this long starts listening (a quicker press just types a space).
const FIELD_HOLD_MS = 400;

type FieldHold = {
  timer: number;
  value: string; // the field as it was before the press, restored if the press turns into a hold
  started: boolean;
  end: () => void;
};

interface MeetInputBarProps {
  sessionId: string;
  text: string;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  status: ConsultStatus;
  onVoiceResult: (text: string) => void;
  onListeningChange: (listening: boolean) => void;
  voiceDisabled: boolean;
  voiceButtonRef: React.RefObject<VoiceButtonHandle>;
  /** Lets the host focus the text field (e.g. after picking a suggested question). */
  fieldRef?: React.RefObject<HTMLInputElement>;
}

export default function MeetInputBar({
  sessionId,
  text,
  onTextChange,
  onSubmit,
  onStop,
  status,
  onVoiceResult,
  onListeningChange,
  voiceDisabled,
  voiceButtonRef,
  fieldRef,
}: MeetInputBarProps) {
  const phone = useMediaQuery("(max-width: 699px)");
  const [dragOver, setDragOver] = useState(false);
  const [voiceUi, setVoiceUi] = useState<VoiceUi | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const localFieldRef = useRef<HTMLInputElement>(null);
  const field = fieldRef ?? localFieldRef;
  const holdRef = useRef<FieldHold | null>(null);
  const appendBaseRef = useRef<string | null>(null); // typed text present when a Space hold began: the spoken words are appended to it
  const refocusRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const idle = status === "idle";
  const { files, error: attachError, addFiles, removeFile, atLimit } = useAttachments(sessionId, idle);
  const textLocked = !idle;
  // Listening or processing: the whole bar turns into the voice visualizer. Driven by the host status alone, which never has a gap
  // between "listening" and "processing" (the voice button's own state lags a render behind and used to flash a stale frame).
  const voiceActive = status === "listening" || status === "processing";
  const voiceMode = status === "processing" ? "processing" : "listening";
  const listening = voiceActive && voiceMode === "listening";
  // One mic, fixed at the far right. Send appears to its left when there is text; Stop appears there while an answer is on its way.
  const showStop = status === "processing" || status === "speaking";
  const showSend = idle && !voiceActive && text.trim().length > 0;
  const attachDisabled = !idle || atLimit;

  // Latest props for the hold's timer and window listeners, which outlive a render.
  const latest = useRef({ status, onTextChange });
  latest.current = { status, onTextChange };

  useEffect(() => () => holdRef.current?.end(), []);

  // After a hold that began in the field ends (finished, cancelled or nothing heard), give the field back with the caret at the end.
  const previousStatus = useRef(status);
  useEffect(() => {
    const was = previousStatus.current;
    previousStatus.current = status;
    if (status !== "idle" || was === "idle") return;
    appendBaseRef.current = null;
    if (!refocusRef.current) return;
    refocusRef.current = false;
    const input = field.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [status, field]);

  const handleVoiceResult = (spoken: string) => {
    const base = appendBaseRef.current;
    appendBaseRef.current = null;
    if (base === null) {
      refocusRef.current = false;
      onVoiceResult(spoken); // the field was empty (or the mic button was used): send, as always
      return;
    }
    onTextChange(`${base}${/\s$/.test(base) ? "" : " "}${spoken}`); // typed text stays and can still be edited; nothing is sent
  };

  // Space in the text field: a quick press types a space as usual; holding it starts listening (like holding the mic).
  const onSpaceDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.repeat) {
      if (holdRef.current) e.preventDefault(); // no stream of spaces while the key is held
      return;
    }
    if (e.nativeEvent.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey) return;
    holdRef.current?.end();

    const value = e.currentTarget.value;
    const hold: FieldHold = {
      timer: 0,
      value,
      started: false,
      end: () => {
        window.clearTimeout(hold.timer);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("keydown", onRepeat, true);
        window.removeEventListener("blur", hold.end);
        if (holdRef.current === hold) holdRef.current = null;
        if (hold.started) voiceButtonRef.current?.endHold();
        hold.started = false;
      },
    };
    // Window level, because the field is disabled (and loses focus) once listening starts.
    const onKeyUp = (ev: KeyboardEvent) => ev.code === "Space" && hold.end();
    const onRepeat = (ev: KeyboardEvent) => ev.code === "Space" && ev.repeat && ev.preventDefault();
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("keydown", onRepeat, true);
    window.addEventListener("blur", hold.end);
    holdRef.current = hold;

    hold.timer = window.setTimeout(() => {
      const voice = voiceButtonRef.current;
      if (holdRef.current !== hold || latest.current.status !== "idle" || !voice?.canHold()) return; // the space stays as typed
      hold.started = true;
      appendBaseRef.current = value.trim() ? value : null;
      refocusRef.current = true;
      latest.current.onTextChange(value); // take the stray space back out
      voice.beginHold();
    }, FIELD_HOLD_MS);
  };

  const cancelVoice = () => {
    voiceButtonRef.current?.cancel();
    barRef.current?.querySelector<HTMLButtonElement>(".voice-bubble--mic")?.focus(); // keep keyboard focus on the mic
  };

  return (
    <div className="meet-input">
      <AttachmentChips files={files} onRemove={removeFile} />
      <div
        ref={barRef}
        className={`meet-input-bar${voiceActive ? " meet-input-bar--voice" : ""}${listening ? " meet-input-bar--listening" : ""}${dragOver ? " meet-input-bar--drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        <VoiceWaveBar ui={voiceUi} active={voiceActive} mode={voiceMode} />
        <div className="meet-input-bar__row">
          <button type="button" className="meet-input-bar__cancel" aria-label="Cancel" tabIndex={listening ? 0 : -1} onClick={cancelVoice}>
            <X size={18} aria-hidden="true" />
          </button>
          <div className="meet-input-bar__left" aria-hidden={voiceActive || undefined}>
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              multiple
              accept={ALLOWED_EXTENSIONS.join(",")}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="meet-input-bar__icon-btn"
              aria-label="Attach documents"
              title="Documents are sent to our server and processed by Google Gemini to answer you."
              disabled={attachDisabled}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={18} />
            </button>

            <input
              ref={field}
              type="text"
              className="meet-input-bar__field"
              placeholder={phone ? "Type a question…" : "Type a question, or hold Space to talk…"} // no Space bar on a phone
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              disabled={textLocked}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                } else if (e.code === "Space") onSpaceDown(e);
              }}
            />
          </div>

          <div className="meet-input-bar__right">
            {showStop && (
              <button type="button" className="meet-input-bar__round meet-input-bar__round--stop" aria-label="Stop" onClick={onStop}>
                <Square size={14} aria-hidden="true" />
              </button>
            )}
            {showSend && (
              <button type="button" className="meet-input-bar__round" aria-label="Send" onClick={onSubmit}>
                <ArrowUp size={18} aria-hidden="true" />
              </button>
            )}
            <VoiceButton
              ref={voiceButtonRef}
              variant="mic"
              buttonSize={56}
              label="Talk"
              disabled={voiceDisabled}
              processing={status === "processing"}
              onResult={handleVoiceResult}
              onListeningChange={onListeningChange}
              onUiChange={setVoiceUi}
            />
          </div>
        </div>
      </div>

      {voiceUi?.error && (
        <p className="meet-input__error" role="alert">
          {voiceUi.error}
        </p>
      )}
      {attachError && (
        <p className="meet-input__error" role="alert">
          {attachError}
        </p>
      )}
    </div>
  );
}
