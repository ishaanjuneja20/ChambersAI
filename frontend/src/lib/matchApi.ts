import { DEMO_LAWYERS, inKeywordMatchOrder } from "./demoLawyers";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface MatchResult {
  lawyerId: string;
  reason: string;
}

function demoMatch(text: string, filesOnly = false): MatchResult {
  const lower = text.toLowerCase();
  for (const lawyer of inKeywordMatchOrder(DEMO_LAWYERS)) {
    const hit = lawyer.keywords.find((k) => lower.includes(k));
    if (hit) {
      return { lawyerId: lawyer.id, reason: `${filesOnly ? "Your documents mention" : "Your description mentions"} "${hit}", which falls under ${lawyer.practice.toLowerCase()}.` };
    }
  }
  return { lawyerId: DEMO_LAWYERS[0].id, reason: `Based on your ${filesOnly ? "documents" : "description"}, here's a good place to start.` };
}

// Backend contract (proposed, not built yet): POST /match {text} -> {lawyer_id, reason, transcript}
export async function matchLawyer(text: string): Promise<MatchResult> {
  if (!API_URL) return demoMatch(text);
  const res = await fetch(`${API_URL}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`POST /match failed: ${res.status}`);
  const data = await res.json();
  return { lawyerId: data.lawyer_id, reason: data.reason };
}

export interface MatchRequest {
  text: string;
  files: File[];
}

// Backend contract (proposed, not built yet): POST /match as multipart/form-data with the field
// "text" and a repeated "files" field (one per attachment) -> {lawyer_id, reason}, the same
// response shape as matchLawyer. In demo mode (no VITE_API_URL) it uses the keyword matcher over
// the text plus the file names (e.g. "rent-agreement.pdf" hits the property keywords); file
// contents are never read.
export async function matchLawyerWithFiles({ text, files }: MatchRequest): Promise<MatchResult> {
  if (!API_URL) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const fileNames = files.map((f) => f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
    return demoMatch([text, ...fileNames].join(" "), !text.trim());
  }
  const body = new FormData();
  body.append("text", text);
  for (const file of files) body.append("files", file);
  const res = await fetch(`${API_URL}/match`, { method: "POST", body });
  if (!res.ok) throw new Error(`POST /match failed: ${res.status}`);
  const data = await res.json();
  return { lawyerId: data.lawyer_id, reason: data.reason };
}
