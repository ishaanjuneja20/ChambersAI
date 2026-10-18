import { useEffect, useState } from "react";
import { getLawyers } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import { getDemoAnswer, detectDomain } from "../lib/demoAnswers";
import type { Citation, TranscriptTurn } from "../lib/consultTypes";
import { getSession, upsertSession } from "../lib/sessionsStore";

// Shared between Meet and Chat so switching between them never loses the conversation — both
// pages read/write the same session id's transcript.
export function useConsultationSession(lawyerId: string, sessionId: string) {
  const [allLawyers, setAllLawyers] = useState<Lawyer[]>([]);
  const [lawyer, setLawyer] = useState<Lawyer | null | undefined>(undefined);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [handoff, setHandoff] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    getLawyers().then((list) => {
      setAllLawyers(list);
      const current = list.find((l) => l.id === lawyerId) ?? null;
      const existing = getSession(sessionId);
      setLawyer(existing ? list.find((l) => l.id === existing.lawyerId) ?? current : current);
      setTranscript(existing?.transcript ?? []);
    });
  }, [lawyerId, sessionId]);

  const persist = (nextTranscript: TranscriptTurn[], currentLawyer: Lawyer) => {
    const lastLawyerTurn = [...nextTranscript].reverse().find((t) => t.role === "lawyer");
    const firstUserTurn = nextTranscript.find((t) => t.role === "user");
    upsertSession({
      id: sessionId,
      lawyerId: currentLawyer.id,
      lawyerName: currentLawyer.name,
      domain: currentLawyer.domain,
      title: firstUserTurn?.text.slice(0, 60) || "Consultation",
      createdAt: getSession(sessionId)?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      transcript: nextTranscript,
    });
    void lastLawyerTurn;
  };

  const addUserTurn = (text: string) => {
    if (!lawyer) return;
    setTranscript((prev) => {
      const next = [...prev, { id: `u-${Date.now()}`, role: "user" as const, text }];
      persist(next, lawyer);
      return next;
    });
  };

  // Decides who answers (handing off if the question belongs to another domain) and returns the
  // canned answer. Does not touch transcript — callers add the lawyer's turn once presented.
  const resolveAnswer = (text: string): { answeringLawyer: Lawyer; answer: string; citations: Citation[] } => {
    let answeringLawyer = lawyer!;
    const detected = detectDomain(text);
    if (detected && detected !== lawyer!.domain) {
      const match = allLawyers.find((l) => l.domain === detected);
      if (match) {
        setHandoff({ from: lawyer!.name, to: match.name });
        setLawyer(match);
        answeringLawyer = match;
        window.setTimeout(() => setHandoff(null), 6000);
      }
    }
    const { answer, citations } = getDemoAnswer(answeringLawyer.domain);
    return { answeringLawyer, answer, citations };
  };

  const addLawyerTurn = (text: string, citations: Citation[], answeringLawyer: Lawyer) => {
    setTranscript((prev) => {
      const next = [...prev, { id: `l-${Date.now()}`, role: "lawyer" as const, text, citations }];
      persist(next, answeringLawyer);
      return next;
    });
  };

  const citations: Citation[] = transcript.flatMap((t) => t.citations ?? []);

  return { lawyer, allLawyers, transcript, citations, handoff, addUserTurn, resolveAnswer, addLawyerTurn };
}
