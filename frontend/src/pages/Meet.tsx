import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import Avatar from "../components/Avatar";
import { getLawyerModel } from "../components/avatar3d/lawyerModels";
import SourcesPanel from "../components/SourcesPanel";
import HandoffBanner from "../components/HandoffBanner";
import MeetInputBar from "../components/MeetInputBar";
import { type VoiceButtonHandle } from "../components/voice/VoiceButton";
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
  const { speak, stop: stopSpeaking, supported: speechSupported, lipSync } = useSpeak();
  // 3D lawyers are driven by `lipSync` inside their render loop; the per-frame synthetic level (React
  // state) is only needed by the 2D portraits.
  const has3D = !!lawyer && !!getLawyerModel(lawyer.id);
  const audioLevel = useSyntheticSpeechLevel(status === "speaking" && !has3D);

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
        { lawyerId: answeringLawyer.id },
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

        <Avatar lawyer={lawyer} status={status} audioLevel={audioLevel} size="large" lipSync={lipSync} />

        <div className="meet__captions" ref={captionsRef} aria-live="polite">
          {transcript.map((turn) => (
            <p key={turn.id} className={`meet__turn meet__turn--${turn.role}`}>
              {turn.text}
            </p>
          ))}
          {liveCaption && <p className="meet__turn meet__turn--lawyer">{liveCaption.text.slice(0, liveCaption.visibleChars) || "…"}</p>}
        </div>

        <div className="meet__controls">
          <MeetInputBar
            sessionId={sessionId}
            text={text}
            onTextChange={setText}
            onSubmit={handleTextSubmit}
            onStop={handleStop}
            status={status}
            onVoiceResult={(result) => void submitQuestion(result)}
            onListeningChange={(isListening) => setStatus(isListening ? "listening" : "idle")}
            voiceDisabled={status !== "idle" && status !== "listening"}
            voiceButtonRef={voiceButtonRef}
          />
          <p className="meet__disclaimer">
            General information, not legal advice.
            {!speechSupported && " (Voice playback isn't supported in this browser — captions still work.)"}
          </p>
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
