import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Square, MessageSquare } from "lucide-react";
import Avatar from "../components/Avatar";
import SourcesPanel from "../components/SourcesPanel";
import HandoffBanner from "../components/HandoffBanner";
import VoiceButton, { type VoiceButtonHandle } from "../components/voice/VoiceButton";
import type { ConsultStatus } from "../lib/consultTypes";
import { useConsultationSession } from "../hooks/useConsultationSession";
import { useSessionId } from "../hooks/useSessionId";
import { useSpeak } from "../hooks/useSpeak";
import { useSyntheticSpeechLevel } from "../hooks/useSyntheticSpeechLevel";
import "./Meet.css";

const STATUS_LABEL: Record<ConsultStatus, string> = {
  idle: "Idle",
  listening: "Listening",
  processing: "Processing",
  speaking: "Speaking",
};

export default function Meet() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const sessionId = useSessionId();

  const { lawyer, transcript, citations, handoff, addUserTurn, resolveAnswer, addLawyerTurn } = useConsultationSession(id, sessionId);

  const [status, setStatus] = useState<ConsultStatus>("idle");
  const [liveCaption, setLiveCaption] = useState<{ text: string; visibleChars: number } | null>(null);
  const [text, setText] = useState("");

  const captionsRef = useRef<HTMLDivElement>(null);
  const voiceButtonRef = useRef<VoiceButtonHandle>(null);
  const { speak, stop: stopSpeaking, supported: speechSupported } = useSpeak();
  const audioLevel = useSyntheticSpeechLevel(status === "speaking");

  useEffect(() => {
    captionsRef.current?.scrollTo({ top: captionsRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, liveCaption]);

  if (lawyer === undefined) return null;
  if (lawyer === null) {
    return (
      <div className="meet">
        <p>This lawyer profile doesn't exist.</p>
      </div>
    );
  }

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    addUserTurn(trimmed);
    setStatus("processing");
    setText("");

    window.setTimeout(() => {
      const { answeringLawyer, answer, citations: answerCitations } = resolveAnswer(trimmed);
      setStatus("speaking");
      setLiveCaption({ text: answer, visibleChars: 0 });
      speak(
        answer,
        (charIndex) => setLiveCaption((prev) => (prev ? { ...prev, visibleChars: charIndex } : prev)),
        () => {
          setLiveCaption(null);
          addLawyerTurn(answer, answerCitations, answeringLawyer);
          setStatus("idle");
        },
      );
    }, 500);
  }

  const handleStop = () => {
    stopSpeaking();
    voiceButtonRef.current?.cancel();
    setLiveCaption(null);
    setStatus("idle");
  };

  const handleTextSubmit = () => {
    if (status !== "idle") return;
    void submitQuestion(text);
  };

  return (
    <div className="meet">
      <div className="meet__room">
        <div className="meet__header">
          <div>
            <h1>{lawyer.name}</h1>
            <p>{lawyer.practice}</p>
          </div>
          <span className="meet__status">{STATUS_LABEL[status]}</span>
        </div>

        {handoff && <HandoffBanner fromName={handoff.from} toName={handoff.to} />}

        <Avatar lawyer={lawyer} status={status} audioLevel={audioLevel} size="large" />

        <div className="meet__captions" ref={captionsRef} aria-live="polite">
          {transcript.map((turn) => (
            <p key={turn.id} className={`meet__turn meet__turn--${turn.role}`}>
              {turn.text}
            </p>
          ))}
          {liveCaption && <p className="meet__turn meet__turn--lawyer">{liveCaption.text.slice(0, liveCaption.visibleChars) || "…"}</p>}
        </div>
        <p className="meet__disclaimer">
          General information, not legal advice.
          {!speechSupported && " (Voice playback isn't supported in this browser — captions still work.)"}
        </p>

        <div className="meet__controls">
          <div className="meet__controls-row">
            <textarea
              className="describe-box__input"
              rows={2}
              placeholder="Type a question, or hold the mic / Space bar to talk…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={status !== "idle"}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleTextSubmit();
                }
              }}
            />
          </div>
          <div className="meet__controls-row">
            <div style={{ position: "relative" }}>
              <VoiceButton
                ref={voiceButtonRef}
                anchor="above"
                disabled={status !== "idle" && status !== "listening"}
                processing={status === "processing"}
                onResult={(result) => void submitQuestion(result)}
                onListeningChange={(isListening) => setStatus(isListening ? "listening" : "idle")}
              />
            </div>
            <button type="button" className="btn btn--primary" onClick={handleTextSubmit} disabled={status !== "idle" || !text.trim()}>
              Send
            </button>
            <button type="button" className="btn btn--outline meet__stop" onClick={handleStop} disabled={status === "idle"}>
              <Square size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
              Stop
            </button>
          </div>
          <div className="meet__controls-row">
            <button
              type="button"
              className="link-button"
              onClick={() => navigate(`/consultation/chat/${lawyer.id}?session=${sessionId}`)}
            >
              <MessageSquare size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} />
              Switch to Chat
            </button>
            <button type="button" className="link-button" onClick={() => navigate(`/lawyers/${lawyer.id}`)}>
              Back to profile
            </button>
          </div>
        </div>
      </div>

      <SourcesPanel citations={citations} />
    </div>
  );
}
