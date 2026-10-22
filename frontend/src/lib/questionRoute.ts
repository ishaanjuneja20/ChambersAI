// Decides where a question goes, before anything is sent. Used for every question in Meet and Chat, typed, spoken (after transcription)
// or picked from a chip.
import { sessionForAsk } from "./attachments";
import { detectMetaIntent, type MetaIntent } from "./metaIntent";

export type QuestionRoute =
  /** A greeting or help request: answered in the app with the lawyer's introduction. Nothing is sent, whether or not a document is attached. */
  | { kind: "intro"; intent: MetaIntent }
  /** Sent to the backend: POST /sessions/{sessionId}/ask/stream when `sessionId` is set (the session has an analysed document), else POST /ask/stream. */
  | { kind: "ask"; sessionId?: string };

export function routeQuestion(question: string, sessionId: string): QuestionRoute {
  const intent = detectMetaIntent(question);
  if (intent) return { kind: "intro", intent };
  return { kind: "ask", sessionId: sessionForAsk(sessionId) };
}
