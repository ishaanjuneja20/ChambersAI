import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Avatar, { type ConsultStatus } from "../components/Avatar";
import VoiceOrTextInput from "../components/VoiceOrTextInput";
import CaseIntelligencePanel from "../components/CaseIntelligencePanel";
import { getLawyers, ask } from "../lib/api";
import { DEMO_TIMELINE, DEMO_EVIDENCE } from "../lib/demoData";
import { upsertSession } from "../lib/sessionsStore";
import type { LawyerEntry, TranscriptTurn, Citation, Lang } from "../lib/contract";

interface NavState {
  lawyerId: string;
  question: string;
  language: Lang;
  sessionId?: string;
}

function parseCitations(labels: string[]): Citation[] {
  return labels.map((label) => ({ label, kind: "statute", verification: "verified" as const }));
}

export default function Consultation() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as NavState | null;

  const [lawyers, setLawyers] = useState<LawyerEntry[]>([]);
  const [lawyerId, setLawyerId] = useState(state?.lawyerId ?? "");
  const [status, setStatus] = useState<ConsultStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [handoffFrom, setHandoffFrom] = useState<string | null>(null);
  const [sessionId] = useState(() => state?.sessionId ?? `sess-${Date.now()}`);
  const sentFirstQuestion = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const lawyer = lawyers.find((l) => l.id === lawyerId);
  const allCitations = transcript.flatMap((t) => t.citations ?? []);

  useEffect(() => {
    getLawyers().then(setLawyers);
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (!state || sentFirstQuestion.current || !lawyers.length) return;
    sentFirstQuestion.current = true;
    if (state.question.trim()) void sendQuestion(state.question, lawyerId);
  }, [lawyers.length]);

  if (!state) {
    navigate("/home", { replace: true });
    return null;
  }

  async function sendQuestion(question: string, forLawyerId: string) {
    const userTurn: TranscriptTurn = { id: `u-${Date.now()}`, role: "user", text: question };
    setTranscript((prev) => [...prev, userTurn]);
    setStatus("processing");
    try {
      const current = lawyers.find((l) => l.id === forLawyerId) ?? lawyers[0];
      const res = await ask(current.domain, question, state?.language);
      const lawyerTurn: TranscriptTurn = {
        id: `l-${Date.now()}`,
        role: "lawyer",
        text: res.refused ? "I don't have a reliable source for this. Please consult an advocate directly." : res.answer,
        citations: parseCitations(res.citations),
      };
      setStatus("speaking");
      setTranscript((prev) => {
        const next = [...prev, lawyerTurn];
        upsertSession({
          id: sessionId,
          lawyerId: forLawyerId,
          lawyerName: current.name,
          domain: current.domain,
          title: question.slice(0, 60) || "Consultation",
          createdAt: new Date().toISOString(),
          lastMessage: lawyerTurn.text.slice(0, 80),
          transcript: next,
        });
        return next;
      });
      window.setTimeout(() => setStatus("idle"), 1200);
    } catch {
      setStatus("idle");
      setTranscript((prev) => [...prev, { id: `err-${Date.now()}`, role: "lawyer", text: "Something went wrong reaching the lawyer. Please try again." }]);
    }
  }

  const handleSwitchLawyer = (newId: string) => {
    if (newId === lawyerId) return;
    setHandoffFrom(lawyer?.name ?? lawyerId);
    setLawyerId(newId);
    window.setTimeout(() => setHandoffFrom(null), 6000);
  };

  if (!lawyer) {
    return (
      <AppShell>
        <p className="page-loading">Loading lawyer…</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="consultation-layout">
        <aside className="consultation-sidebar">
          <h3>This consultation</h3>
          <div className="consultation-sidebar__lawyer">
            <Avatar lawyer={lawyer} size="small" />
            <div>
              <strong>{lawyer.name}</strong>
              <p>{lawyer.domain}</p>
            </div>
          </div>
          <p className="consultation-sidebar__status">Status: {status}</p>
          <button className="btn btn--ghost btn--small" onClick={() => setStatus("idle")}>
            Stop
          </button>
          <h4>Switch lawyer</h4>
          <ul className="consultation-sidebar__switch-list">
            {lawyers.filter((l) => l.id !== lawyerId).map((l) => (
              <li key={l.id}>
                <button className="link-button" onClick={() => handleSwitchLawyer(l.id)}>
                  {l.name} ({l.domain})
                </button>
              </li>
            ))}
          </ul>
          <button className="btn btn--outline btn--small" onClick={() => navigate("/consultations")}>
            Back to my consultations
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => navigate("/case-summary")}>
            View case summary
            <span className="badge badge--demo-mini">demo</span>
          </button>
        </aside>

        <section className="consultation-center">
          {handoffFrom && (
            <div className="handoff-banner" role="status">
              You've been handed off from {handoffFrom} to {lawyer.name}.
            </div>
          )}
          <div className="consultation-center__avatar">
            <Avatar lawyer={lawyer} status={status} size="large" />
            <p className="consultation-center__disclaimer">General information, not legal advice.</p>
          </div>

          <div className="transcript" aria-live="polite">
            {transcript.map((turn) => (
              <div key={turn.id} className={`transcript__turn transcript__turn--${turn.role}`}>
                <p>{turn.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>

          <VoiceOrTextInput
            lang={state.language}
            placeholder="Ask a follow-up question..."
            onSubmit={(text) => sendQuestion(text, lawyerId)}
            disabled={status === "processing" || status === "speaking"}
          />
        </section>

        <CaseIntelligencePanel citations={allCitations} timeline={DEMO_TIMELINE} evidence={DEMO_EVIDENCE} />
      </div>
    </AppShell>
  );
}
