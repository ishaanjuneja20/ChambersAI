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
// The endpoint does not exist on the backend yet, so a 404, any other failed status, a network error or an
// unusable body quietly falls back to the keyword matcher: the assistant always works.
export async function matchLawyer(text: string): Promise<MatchResult> {
  if (!API_URL) return demoMatch(text);
  try {
    const res = await fetch(`${API_URL}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return await readMatch(res);
  } catch {
    return demoMatch(text);
  }
}

async function readMatch(res: Response): Promise<MatchResult> {
  if (!res.ok) throw new Error(`POST /match failed: ${res.status}`);
  const data = await res.json();
  if (typeof data?.lawyer_id !== "string" || typeof data?.reason !== "string") throw new Error("POST /match returned an unexpected body");
  return { lawyerId: data.lawyer_id, reason: data.reason };
}

export interface MatchRequest {
  text: string;
  files: File[];
}

// Keyword matcher over the text plus the file names (e.g. "rent-agreement.pdf" hits the property keywords);
// file contents are never read.
async function demoMatchWithFiles({ text, files }: MatchRequest): Promise<MatchResult> {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const fileNames = files.map((f) => f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  return demoMatch([text, ...fileNames].join(" "), !text.trim());
}

// Backend contract (proposed, not built yet): POST /match as multipart/form-data with the field
// "text" and a repeated "files" field (one per attachment) -> {lawyer_id, reason}, the same
// response shape as matchLawyer. In demo mode (no VITE_API_URL), or when the backend cannot answer
// (see matchLawyer), it uses the keyword matcher.
export async function matchLawyerWithFiles(request: MatchRequest): Promise<MatchResult> {
  if (!API_URL) return demoMatchWithFiles(request);
  try {
    const body = new FormData();
    body.append("text", request.text);
    for (const file of request.files) body.append("files", file);
    const res = await fetch(`${API_URL}/match`, { method: "POST", body });
    return await readMatch(res);
  } catch {
    return demoMatchWithFiles(request);
  }
}
