import { useRef, useState } from "react";
import { Plus, FileText, X, ArrowUp, Square, AudioWaveform } from "lucide-react";
import VoiceButton, { type VoiceButtonHandle } from "./voice/VoiceButton";
import type { ConsultStatus } from "../lib/consultTypes";
import "./MeetInputBar.css";

const API_URL = import.meta.env.VITE_API_URL ?? "";

const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg"];
const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

type AttachedFile = {
  id: string;
  file: File;
  status: "uploading" | "attached" | "demo" | "error";
  error?: string;
};

function isAllowedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Backend contract (proposed, not built yet): POST /sessions/{session_id}/documents (multipart,
// field "file"). In demo mode (no VITE_API_URL) this just mocks the round trip.
async function uploadDocument(sessionId: string, file: File): Promise<void> {
  if (!API_URL) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return;
  }
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${API_URL}/sessions/${sessionId}/documents`, { method: "POST", body });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

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
}: MeetInputBarProps) {
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<number>();

  const idle = status === "idle";
  const textLocked = !idle;
  const roundState = status === "processing" || status === "speaking" ? "stop" : text.trim() ? "send" : "waveform";
  const roundDisabled = roundState === "stop" ? false : !idle;
  const attachDisabled = !idle || files.length >= MAX_FILES;

  const showError = (message: string) => {
    setAttachError(message);
    window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setAttachError(null), 5000);
  };

  const addFiles = (incoming: FileList | File[]) => {
    if (!idle) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const room = MAX_FILES - files.length;
    if (room <= 0) {
      showError(`You can attach up to ${MAX_FILES} files.`);
      return;
    }

    const accepted: File[] = [];
    let rejection: string | null = null;
    for (const file of list) {
      if (accepted.length >= room) {
        rejection = `You can attach up to ${MAX_FILES} files.`;
        break;
      }
      if (!isAllowedFile(file)) {
        rejection = `${file.name} isn't supported. Use PDF, Word, text or image files.`;
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        rejection = `${file.name} is larger than 10 MB.`;
        continue;
      }
      accepted.push(file);
    }
    if (rejection) showError(rejection);

    for (const file of accepted) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setFiles((prev) => [...prev, { id, file, status: "uploading" }]);
      uploadDocument(sessionId, file)
        .then(() => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: API_URL ? "attached" : "demo" } : f)));
        })
        .catch(() => {
          setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "error", error: "Upload failed" } : f)));
        });
    }
  };

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  const handleRoundClick = () => {
    if (roundState === "waveform") voiceButtonRef.current?.toggleHandsFree();
    else if (roundState === "send") onSubmit();
    else onStop();
  };

  return (
    <div className="meet-input">
      <div
        className={`meet-input-bar${files.length > 0 ? " meet-input-bar--has-files" : ""}${dragOver ? " meet-input-bar--drag" : ""}`}
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
        {files.length > 0 && (
          <div className="meet-input-bar__chips">
            {files.map((f) => (
              <span key={f.id} className={`meet-input-bar__chip${f.status === "error" ? " meet-input-bar__chip--error" : ""}`}>
                <FileText size={14} aria-hidden="true" />
                <span className="meet-input-bar__chip-name">{f.file.name}</span>
                <span className="meet-input-bar__chip-meta">
                  {f.status === "uploading" && "Uploading…"}
                  {f.status === "attached" && "Attached"}
                  {f.status === "demo" && "Attached (demo: not analysed)"}
                  {f.status === "error" && (f.error ?? "Error")}
                  {(f.status === "attached" || f.status === "demo") && ` · ${formatSize(f.file.size)}`}
                </span>
                <button type="button" className="meet-input-bar__chip-remove" aria-label={`Remove ${f.file.name}`} onClick={() => removeFile(f.id)}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="meet-input-bar__row">
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
            type="text"
            className="meet-input-bar__field"
            placeholder="Type a question, or hold the mic / Space bar to talk…"
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            disabled={textLocked}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
          />

          <VoiceButton
            ref={voiceButtonRef}
            anchor="above"
            disabled={voiceDisabled}
            processing={status === "processing"}
            onResult={onVoiceResult}
            onListeningChange={onListeningChange}
          />

          <button
            type="button"
            className="meet-input-bar__round"
            aria-label={roundState === "send" ? "Send" : roundState === "stop" ? "Stop" : "Start voice conversation"}
            disabled={roundDisabled}
            onClick={handleRoundClick}
          >
            {roundState === "send" && <ArrowUp size={18} />}
            {roundState === "stop" && <Square size={14} />}
            {roundState === "waveform" && <AudioWaveform size={18} />}
          </button>
        </div>
      </div>

      {attachError && (
        <p className="meet-input__error" role="alert">
          {attachError}
        </p>
      )}
    </div>
  );
}
