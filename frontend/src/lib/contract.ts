// Backend contract. The REAL / section matches backend/main.py on the `deploy/oracle` branch today.
// The PROPOSED / section is what this frontend needs but the backend does not build yet — every
// call against it goes through demo mode only and is listed in the PR reply as a contract change.

export type Lang = "en" | "hi";

// ---- REAL (exists on the backend today) ----------------------------------

export interface LawyerEntry {
  id: string;
  name: string;
  domain: string;
  personality: string;
  voice_id: string;
  avatar: string;
}

export interface AskRequest {
  lawyer: string;
  question: string;
  lang?: Lang;
}

export interface AskResponse {
  answer: string;
  citations: string[];
  refused: boolean;
}

// ---- PROPOSED (not built on the backend; demo-mode only) ------------------

export type CitationVerification = "verified" | "interpretation" | "none";

export interface Citation {
  label: string;
  kind: "statute" | "case";
  source_url?: string;
  verification: CitationVerification;
}

export interface MatchRequest {
  text?: string;
  audio?: Blob;
  language: Lang;
}

export interface MatchResponse {
  lawyer_id: string;
  reason: string;
  transcript: string;
}

export type ConsultStatus = "idle" | "listening" | "processing" | "speaking";

export interface TranscriptTurn {
  id: string;
  role: "user" | "lawyer";
  text: string;
  citations?: Citation[];
}

export interface SessionSummaryItem {
  id: string;
  lawyerId: string;
  lawyerName: string;
  domain: string;
  title: string;
  createdAt: string;
  lastMessage: string;
}

export interface CaseSummary {
  keyFacts: string[];
  legalSources: Citation[];
  dates: { label: string; date: string }[];
  missingInformation: string[];
  nextSteps: string[];
}

export interface TimelineEvent {
  id: string;
  date: string;
  description: string;
}

export type EvidenceStatus = "have" | "missing" | "needs_confirmation";

export interface EvidenceItem {
  id: string;
  label: string;
  status: EvidenceStatus;
}

export interface ExtractedFact {
  id: string;
  text: string;
  sourceDocument: string;
  type: "fact" | "date" | "party" | "amount" | "event";
  flagged?: "missing" | "contradictory";
}

export const DEMO_MODE = !import.meta.env.VITE_API_URL;
