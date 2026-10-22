import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { FileText, Mic, Paperclip, X } from "lucide-react";
import VoiceButton, { type VoiceButtonHandle, type VoiceUi } from "./voice/VoiceButton";
import VoiceWaveBar from "./voice/VoiceWaveBar";
import PlaceholderPortrait from "./PlaceholderPortrait";
import { useImageFallback } from "../hooks/useImageFallback";
import { matchLawyerWithFiles } from "../lib/matchApi";
import { getLawyers } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import "./MatchAssistant.css";

const PANEL_ID = "match-assistant-panel";
const PROCESSING_MS = 600; // how long the calm "processing" wave plays before the spoken words land in the box

// Same upload rules as MeetInputBar.
const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg"];
const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// The Meet and Chat screens have their own input bars, which this button would sit on top of.
const HIDDEN_ROUTE_PREFIXES = ["/consultation/meet/", "/consultation/chat/"];

type Status = "idle" | "matching" | "result" | "error";

function isAllowedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function firstName(name: string): string {
  return name.replace(/^Adv\.?\s+/i, "").split(" ")[0];
}

function ResultPortrait({ lawyer }: { lawyer: Lawyer }) {
  const { failed, onError } = useImageFallback();
  return (
    <div className="match-assistant__portrait">
      {failed ? <PlaceholderPortrait seed={lawyer.id} /> : <img src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt="" onError={onError} />}
    </div>
  );
}

export default function MatchAssistant() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const hidden = HIDDEN_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<{ lawyer: Lawyer; reason: string } | null>(null);
  const [voiceUi, setVoiceUi] = useState<VoiceUi | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const voiceRef = useRef<VoiceButtonHandle>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const errorTimerRef = useRef<number>();
  const processingTimerRef = useRef<number>();

  const matching = status === "matching";
  // The tools row turns into the voice visualizer while listening and while the words are being processed. The mic's own state lags a render
  // behind the host's, so "listening" comes from the host (set together with the processing flag, so there is no gap between them).
  const voiceActive = voiceProcessing || (listening && (voiceUi?.expanded ?? true));
  const voiceMode = voiceProcessing ? "processing" : "listening";
  const canSubmit = !matching && (text.trim().length > 0 || files.length > 0);

  const closePanel = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Close on route change, and whenever the button is hidden (Meet / Chat).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The mic must never be left running behind a closed panel.
  useEffect(() => {
    if (!open) voiceRef.current?.cancel();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => (textareaRef.current ?? panelRef.current)?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(
    () => () => {
      window.clearTimeout(errorTimerRef.current);
      window.clearTimeout(processingTimerRef.current);
    },
    [],
  );

  // Spoken words are appended to the description (never sent) once the short "processing" wave has played.
  const handleSpoken = (spoken: string) => {
    setVoiceProcessing(true);
    window.clearTimeout(processingTimerRef.current);
    processingTimerRef.current = window.setTimeout(() => {
      setText((prev) => (prev ? `${prev} ${spoken}` : spoken));
      setVoiceProcessing(false);
    }, PROCESSING_MS);
  };

  const showFileError = (message: string) => {
    setFileError(message);
    window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setFileError(null), 6000);
  };

  const addFiles = (incoming: FileList | File[]) => {
    if (matching) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const accepted: File[] = [];
    let rejection: string | null = null;
    for (const file of list) {
      if (files.length + accepted.length >= MAX_FILES) {
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
      if ([...files, ...accepted].some((f) => f.name === file.name && f.size === file.size)) {
        rejection = `${file.name} is already attached.`;
        continue;
      }
      accepted.push(file);
    }
    if (rejection) showFileError(rejection);
    else setFileError(null);
    if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    voiceRef.current?.cancel(); // never leave the mic running behind the result
    setStatus("matching");
    try {
      const match = await matchLawyerWithFiles({ text: text.trim(), files });
      const lawyer = (await getLawyers()).find((l) => l.id === match.lawyerId);
      if (!lawyer) throw new Error(`Unknown lawyer id: ${match.lawyerId}`);
      setResult({ lawyer, reason: match.reason });
      setStatus("result");
    } catch {
      setStatus("error");
    }
  };

  const startOver = () => {
    setText("");
    setFiles([]);
    setFileError(null);
    setResult(null);
    setStatus("idle");
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  if (hidden) return null;

  const spring = prefersReducedMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 420, damping: 26 };
  const iconTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.28, ease: "easeOut" as const };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panelRef}
            id={PANEL_ID}
            role="dialog"
            aria-label="Find your lawyer"
            tabIndex={-1}
            className={`match-assistant__panel${dragOver ? " match-assistant__panel--drag" : ""}`}
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.9, y: 10, transition: { duration: 0.16 } }}
            transition={spring}
            onDragOver={(e) => {
              if (matching || status === "result") return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (status !== "result" && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            <header className="match-assistant__header">
              <div>
                <h2 className="match-assistant__title">Find your lawyer</h2>
                <p className="match-assistant__subtitle">Tell us about your case and we'll match you with the right advocate</p>
              </div>
              <button type="button" className="match-assistant__close" aria-label="Close" onClick={closePanel}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <div className="match-assistant__body">
              {status === "result" && result ? (
                <div className="match-assistant__result" aria-live="polite">
                  <p className="match-assistant__badge">Best match</p>
                  <div className="match-assistant__lawyer">
                    <ResultPortrait lawyer={result.lawyer} />
                    <div className="match-assistant__lawyer-text">
                      <p className="match-assistant__lawyer-name">{result.lawyer.name}</p>
                      <p className="match-assistant__lawyer-practice">{result.lawyer.practice}</p>
                    </div>
                  </div>
                  <p className="match-assistant__reason">{result.reason}</p>
                  <div className="match-assistant__result-actions">
                    <button type="button" className="btn btn--primary" onClick={() => navigate(`/consultation/meet/${result.lawyer.id}`)}>
                      Meet {firstName(result.lawyer.name)}
                    </button>
                    <button type="button" className="btn btn--outline" onClick={() => navigate(`/consultation/chat/${result.lawyer.id}`)}>
                      Chat
                    </button>
                  </div>
                  <div className="match-assistant__links">
                    <button type="button" className="link-button" onClick={() => navigate(`/lawyers/${result.lawyer.id}`)}>
                      View profile
                    </button>
                    <button type="button" className="link-button" onClick={startOver}>
                      Start over
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <textarea
                    ref={textareaRef}
                    className="match-assistant__input"
                    rows={4}
                    placeholder="Describe your case in your own words..."
                    aria-label="Describe your case"
                    value={text}
                    disabled={matching}
                    onChange={(e) => setText(e.target.value)}
                  />

                  <div className={`match-assistant__tools${voiceActive ? " match-assistant__tools--voice" : ""}`}>
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
                    <div className="match-assistant__tool match-assistant__tool--attach" aria-hidden={voiceActive || undefined}>
                      <button
                        type="button"
                        className="btn btn--outline match-assistant__bar"
                        tabIndex={voiceActive ? -1 : undefined}
                        disabled={matching || files.length >= MAX_FILES}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip size={15} aria-hidden="true" /> Attach files
                      </button>
                    </div>
                    <div className={`match-assistant__tool match-assistant__mic${voiceActive ? " match-assistant__mic--voice" : ""}${listening && voiceActive && !voiceProcessing ? " match-assistant__mic--listening" : ""}`}>
                      <VoiceWaveBar ui={voiceUi} active={voiceActive} mode={voiceMode} />
                      <button
                        type="button"
                        className="match-assistant__mic-cancel"
                        aria-label="Cancel"
                        tabIndex={voiceActive && !voiceProcessing ? 0 : -1}
                        onClick={() => {
                          voiceRef.current?.cancel();
                          micButtonRef.current?.focus();
                        }}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                      <VoiceButton
                        ref={voiceRef}
                        enableSpaceBar={false}
                        disabled={matching}
                        processing={voiceProcessing}
                        onUiChange={setVoiceUi}
                        onListeningChange={setListening}
                        onTranscribingChange={setVoiceProcessing}
                        onResult={handleSpoken}
                        renderTrigger={(trigger) => (
                          <button
                            ref={micButtonRef}
                            type="button"
                            className="btn btn--outline match-assistant__bar match-assistant__mic-btn"
                            aria-label="Speak"
                            aria-pressed={trigger.listening}
                            aria-disabled={matching || undefined}
                            // Hold to talk or tap to toggle, like the live consultation's mic. Pointer capture keeps the release coming here even if the finger or cursor has moved off.
                            onPointerDown={(e) => {
                              e.currentTarget.setPointerCapture?.(e.pointerId);
                              trigger.onPointerDown(e);
                            }}
                            onPointerUp={trigger.onPointerUp}
                            onPointerCancel={trigger.onPointerUp}
                            onKeyDown={(e) => {
                              if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
                                e.preventDefault();
                                voiceRef.current?.toggleHandsFree();
                              }
                            }}
                          >
                            <span className="match-assistant__mic-label">
                              <Mic size={15} aria-hidden="true" /> Speak
                            </span>
                            <span className="match-assistant__mic-live" aria-hidden="true">
                              <Mic size={16} />
                            </span>
                          </button>
                        )}
                      />
                    </div>
                  </div>

                  {voiceUi?.error && (
                    <p className="auth-error" role="alert">
                      {voiceUi.error}
                    </p>
                  )}

                  {files.length > 0 && (
                    <ul className="match-assistant__chips" aria-label="Attached files">
                      {files.map((file) => (
                        <li key={`${file.name}-${file.size}`} className="match-assistant__chip">
                          <FileText size={14} aria-hidden="true" />
                          <span className="match-assistant__chip-name">{file.name}</span>
                          <span className="match-assistant__chip-size">{formatSize(file.size)}</span>
                          <button
                            type="button"
                            className="match-assistant__chip-remove"
                            aria-label={`Remove ${file.name}`}
                            disabled={matching}
                            onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="match-assistant__limits">PDF, Word, text or images · up to {MAX_FILES} files, 10 MB each</p>

                  {fileError && (
                    <p className="auth-error" role="alert">
                      {fileError}
                    </p>
                  )}
                  {status === "error" && (
                    <p className="auth-error" role="alert">
                      Couldn't reach the matching service. Please try again, or pick a lawyer directly.
                    </p>
                  )}

                  <button type="button" className="btn btn--primary match-assistant__submit" disabled={!canSubmit} onClick={handleSubmit}>
                    {matching ? (
                      <>
                        <span className="match-assistant__dots" aria-hidden="true">
                          <span />
                          <span />
                          <span />
                        </span>
                        Finding the right lawyer...
                      </>
                    ) : status === "error" ? (
                      "Try again"
                    ) : (
                      "Find my lawyer"
                    )}
                  </button>
                </>
              )}

              <p className="match-assistant__note">Uploaded files are used only to find your match.</p>
            </div>

            <div className="match-assistant__drop" aria-hidden="true">
              Drop files to attach
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        ref={buttonRef}
        type="button"
        className={`match-assistant__fab${open ? " match-assistant__fab--open" : ""}`}
        aria-label="Find my lawyer"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => (open ? closePanel() : setOpen(true))}
        whileTap={prefersReducedMotion ? undefined : { scale: 0.9 }}
        transition={spring}
      >
        <motion.img
          className="match-assistant__fab-icon"
          src="/brand/logo-mark.png"
          alt=""
          draggable={false}
          animate={{ opacity: open ? 0 : 1, rotate: open ? 180 : 0, scale: open ? 0.5 : 1 }}
          transition={iconTransition}
        />
        <motion.span
          className="match-assistant__fab-icon"
          aria-hidden="true"
          animate={{ opacity: open ? 1 : 0, rotate: open ? 0 : -180, scale: open ? 1 : 0.5 }}
          transition={iconTransition}
        >
          <X size={24} />
        </motion.span>
      </motion.button>
    </>
  );
}
