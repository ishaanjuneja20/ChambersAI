import type { AskResponse, LawyerEntry, Lang } from "./contract";
import { DEMO_MODE } from "./contract";
import { DEMO_LAWYERS, demoMatch, demoAnswer } from "./demoData";
import { getAccessToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL ?? "";

async function authedFetch(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

// ---- REAL: GET /lawyers ----------------------------------------------------
export async function getLawyers(): Promise<LawyerEntry[]> {
  if (DEMO_MODE) return DEMO_LAWYERS;
  const res = await authedFetch("/lawyers");
  if (!res.ok) throw new Error(`GET /lawyers failed: ${res.status}`);
  return res.json();
}

// ---- PROPOSED: POST /match (demo mode only today) --------------------------
export async function matchLawyer(text: string, language: Lang): Promise<{ lawyerId: string; reason: string; transcript: string }> {
  if (DEMO_MODE || !API_URL) {
    const { lawyerId, reason } = demoMatch(text);
    return { lawyerId, reason, transcript: text };
  }
  const res = await authedFetch("/match", { method: "POST", body: JSON.stringify({ text, language }) });
  if (!res.ok) throw new Error(`POST /match failed: ${res.status}`);
  const data = await res.json();
  return { lawyerId: data.lawyer_id, reason: data.reason, transcript: data.transcript };
}

// ---- REAL: POST /ask --------------------------------------------------------
export async function ask(lawyerDomain: string, question: string, lang?: Lang): Promise<AskResponse> {
  if (DEMO_MODE) {
    const { answer, citations } = demoAnswer(lawyerDomain, question);
    return { answer, citations: citations.map((c) => c.label), refused: false };
  }
  const res = await authedFetch("/ask", { method: "POST", body: JSON.stringify({ lawyer: lawyerDomain, question, lang }) });
  if (!res.ok) throw new Error(`POST /ask failed: ${res.status}`);
  return res.json();
}
