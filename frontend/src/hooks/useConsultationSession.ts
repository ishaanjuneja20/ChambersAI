import { useEffect, useRef, useState } from "react";
import { getLawyers } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import { getDemoAnswer, detectDomain } from "../lib/demoAnswers";
import type { Citation, TranscriptTurn } from "../lib/consultTypes";
import { buildIntro, offersQuestions } from "../lib/metaIntent";
import { routeQuestion } from "../lib/questionRoute";
import { getStarterQuestions, REFUSAL_SUGGESTIONS } from "../lib/starterQuestions";
import { getSession, upsertSession } from "../lib/sessionsStore";
import { askBackendEnabled } from "../lib/askApi";
import { runAnswerStream, type AnswerHandlers, type AnswerOutcome } from "../lib/answerStream";
import { useSessionDocuments } from "../lib/attachments";

export type { AnswerHandlers, AnswerOutcome } from "../lib/answerStream";

// Shared between Meet and Chat so switching between them never loses the conversation — both
// pages read/write the same session id's transcript.
export function useConsultationSession(lawyerId: string, sessionId: string) {
  const [allLawyers, setAllLawyers] = useState<Lawyer[]>([]);
  const [lawyer, setLawyer] = useState<Lawyer | null | undefined>(undefined);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [handoff, setHandoff] = useState<{ from: string; to: string } | null>(null);
  // Sources of the answer that is still arriving. They show in the sources panel at once and move into the
  // lawyer's turn when addLawyerTurn records it.
  const [liveCitations, setLiveCitations] = useState<Citation[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const askRef = useRef<AbortController | null>(null);
  // The session's analysed documents (shared with the Documents tab): while there is one, the banner shows and questions use it.
  const documents = useSessionDocuments(sessionId);

  // Switching lawyer or leaving the page cuts off the answer in flight.
  useEffect(() => {
    setNotice(null);
    setLiveCitations([]);
    return () => {
      askRef.current?.abort();
      askRef.current = null;
    };
  }, [lawyerId, sessionId]);

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

  // Decides who answers: the current lawyer, or the one whose domain the question belongs to (shown as a handoff).
  const resolveLawyer = (text: string): Lawyer => {
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
    return answeringLawyer;
  };

  // Demo mode: the canned answer for whoever answers. Does not touch transcript — callers add the lawyer's turn once presented.
  const resolveAnswer = (text: string): { answeringLawyer: Lawyer; answer: string; citations: Citation[] } => {
    const answeringLawyer = resolveLawyer(text);
    const { answer, citations } = getDemoAnswer(answeringLawyer.domain);
    return { answeringLawyer, answer, citations };
  };

  const cancelAnswer = () => {
    askRef.current?.abort();
    askRef.current = null;
  };

  // Backend mode: asks `answering` (the lawyer resolveLawyer picked) and reports the answer as it streams in.
  // Starting another question cuts the previous one off; cancelAnswer() or leaving the page does too, and then
  // no handler is called any more (the page records whatever it received).
  const streamAnswer = (question: string, answering: Lawyer, handlers: AnswerHandlers) => {
    cancelAnswer();
    const controller = new AbortController();
    askRef.current = controller;
    setNotice(null);
    setLiveCitations([]);

    // Greetings and "what can you do / what should I ask" never reach the backend, with or without a document attached (so neither
    // /ask/stream nor /sessions/{id}/ask/stream): the lawyer introduces themselves, cites nothing, and offers their suggested questions.
    const route = routeQuestion(question, sessionId);
    if (route.kind === "intro") {
      for (const sentence of buildIntro(answering, route.intent, question)) handlers.onSentence(sentence, []);
      handlers.onComplete([], { kind: "intro", suggestions: offersQuestions(route.intent) ? getStarterQuestions(answering.id) : [] });
      return;
    }

    // The route was read now, not at render: a document attached or removed a moment ago counts. Without one it is the plain /ask/stream.
    void runAnswerStream({
      request: { lawyer: answering.domain, question, signal: controller.signal, sessionId: route.sessionId },
      handlers,
      refusalSuggestions: getStarterQuestions(answering.id).slice(0, REFUSAL_SUGGESTIONS),
      setLiveCitations,
      setNotice,
    });
  };

  const addLawyerTurn = (text: string, citations: Citation[], answeringLawyer: Lawyer, outcome: AnswerOutcome = {}) => {
    setLiveCitations([]); // they are part of the turn now
    setTranscript((prev) => {
      const next = [...prev, { id: `l-${Date.now()}`, role: "lawyer" as const, text, citations, ...(outcome.kind ? { kind: outcome.kind, suggestions: outcome.suggestions } : {}), ...(outcome.general ? { general: true } : {}) }];
      persist(next, answeringLawyer);
      return next;
    });
  };

  const citations: Citation[] = [...transcript.flatMap((t) => t.citations ?? []), ...liveCitations];

  return {
    lawyer,
    allLawyers,
    transcript,
    citations,
    handoff,
    notice,
    documents,
    backendEnabled: askBackendEnabled,
    addUserTurn,
    resolveLawyer,
    resolveAnswer,
    streamAnswer,
    cancelAnswer,
    addLawyerTurn,
  };
}
