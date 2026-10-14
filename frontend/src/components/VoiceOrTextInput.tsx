import { useState } from "react";
import { useSpeechInput } from "../lib/useSpeechInput";

interface VoiceOrTextInputProps {
  lang: "en" | "hi";
  placeholder: string;
  onSubmit: (text: string) => void;
  disabled?: boolean;
  submitLabel?: string;
}

export default function VoiceOrTextInput({ lang, placeholder, onSubmit, disabled, submitLabel = "Send" }: VoiceOrTextInputProps) {
  const [text, setText] = useState("");
  const { supported, recording, start, stop } = useSpeechInput(lang);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  };

  const handleMicPress = () => {
    start((result) => setText((prev) => (prev ? `${prev} ${result}` : result)));
  };

  return (
    <div className="voice-or-text">
      <textarea
        className="voice-or-text__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        rows={2}
        disabled={disabled}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="voice-or-text__actions">
        {supported ? (
          <button
            type="button"
            className={`btn btn--mic${recording ? " btn--mic-active" : ""}`}
            disabled={disabled}
            onMouseDown={handleMicPress}
            onMouseUp={stop}
            onTouchStart={handleMicPress}
            onTouchEnd={stop}
            aria-pressed={recording}
            aria-label="Hold to talk"
          >
            {recording ? "Listening…" : "Hold to talk"}
          </button>
        ) : (
          <span className="voice-or-text__hint">Voice input isn't supported in this browser — type instead.</span>
        )}
        <button type="button" className="btn btn--primary" onClick={submit} disabled={disabled || !text.trim()}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
