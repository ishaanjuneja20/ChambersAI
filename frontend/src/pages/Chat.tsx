import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Radio } from "lucide-react";
import SourcesPanel from "../components/SourcesPanel";
import HandoffBanner from "../components/HandoffBanner";
import { useConsultationSession } from "../hooks/useConsultationSession";
import { useSessionId } from "../hooks/useSessionId";
import "./Chat.css";

export default function Chat() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const sessionId = useSessionId();

  const { lawyer, transcript, citations, handoff, addUserTurn, resolveAnswer, addLawyerTurn } = useConsultationSession(id, sessionId);

  const [text, setText] = useState("");
  const [typing, setTyping] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, typing]);

  if (lawyer === undefined) return null;
  if (lawyer === null) {
    return (
      <div className="chat">
        <p>This lawyer profile doesn't exist.</p>
      </div>
    );
  }

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    addUserTurn(trimmed);
    setText("");
    setTyping(true);

    window.setTimeout(() => {
      const { answeringLawyer, answer, citations: answerCitations } = resolveAnswer(trimmed);
      // A brief, length-proportional typing delay reads more like a real reply than an instant one.
      window.setTimeout(() => {
        addLawyerTurn(answer, answerCitations, answeringLawyer);
        setTyping(false);
      }, Math.min(1800, 400 + answer.length * 8));
    }, 400);
  };

  return (
    <div className="chat">
      <div className="chat__room">
        <div className="chat__header">
          <div>
            <h1>{lawyer.name}</h1>
            <p>{lawyer.practice}</p>
          </div>
        </div>

        {handoff && <HandoffBanner fromName={handoff.from} toName={handoff.to} />}

        <div className="chat__thread" ref={threadRef} aria-live="polite">
          {transcript.map((turn) => (
            <div key={turn.id} className={`chat__bubble chat__bubble--${turn.role}`}>
              {turn.text}
            </div>
          ))}
          {typing && (
            <div className="chat__typing" aria-label={`${lawyer.name} is typing`}>
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
        <p className="chat__disclaimer">General information, not legal advice.</p>

        <div className="chat__controls">
          <textarea
            className="describe-box__input"
            rows={2}
            placeholder="Type a message…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={typing}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={typing || !text.trim()}>
            Send
          </button>
        </div>

        <div className="chat__footer-links">
          <button
            type="button"
            className="link-button"
            onClick={() => navigate(`/consultation/meet/${lawyer.id}?session=${sessionId}`)}
          >
            <Radio size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} />
            Switch to Meet
          </button>
          <button type="button" className="link-button" onClick={() => navigate(`/lawyers/${lawyer.id}`)}>
            Back to profile
          </button>
        </div>
      </div>

      <SourcesPanel citations={citations} />
    </div>
  );
}
