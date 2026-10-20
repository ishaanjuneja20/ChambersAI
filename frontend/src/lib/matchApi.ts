import { DEMO_LAWYERS } from "./demoLawyers";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface MatchResult {
  lawyerId: string;
  reason: string;
}

function demoMatch(text: string): MatchResult {
  const lower = text.toLowerCase();
  for (const lawyer of DEMO_LAWYERS) {
    const hit = lawyer.keywords.find((k) => lower.includes(k));
    if (hit) {
      return { lawyerId: lawyer.id, reason: `Your description mentions "${hit}", which falls under ${lawyer.practice.toLowerCase()}.` };
    }
  }
  return { lawyerId: DEMO_LAWYERS[0].id, reason: "Based on your description, here's a good place to start." };
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
