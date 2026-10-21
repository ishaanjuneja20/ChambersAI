import type { Citation } from "./consultTypes";
import { DEMO_LAWYERS, inKeywordMatchOrder } from "./demoLawyers";

// Demo-mode only. Real answers come from the backend's POST /ask (and, for live Meet/Chat, the
// proposed WS /ws/consult/{lawyer_id}) — see "Changes needed outside frontend/". Every citation
// below is a real, correctly-named statute provision; none are invented, but the "verified"
// label here is illustrative of the UI, not a live source check — that's the backend's job.
interface DomainAnswer {
  answer: string; // 2-4 sentences: what it means, what to do, what to watch for
  citations: Citation[];
}

const DOMAIN_ANSWERS: Record<string, DomainAnswer> = {
  criminal: {
    answer:
      "Here's what this generally means: anyone with knowledge of a cognizable offence can have an FIR registered at the police station with jurisdiction, and they're required to give you a free copy. What you can do: ask for the FIR copy in writing, and if they refuse, you can approach the Superintendent of Police or the jurisdictional Magistrate instead. One thing to watch for: bail procedure differs for bailable and non-bailable offences, so that distinction matters for what happens next.",
    citations: [
      { label: "Bharatiya Nagarik Suraksha Sanhita, 2023, s.173 (FIR registration)", sourceUrl: "https://www.indiacode.nic.in/", confidence: "verified" },
      { label: "Bharatiya Nyaya Sanhita, 2023 (offence classification)", confidence: "interpretation" },
    ],
  },
  family: {
    answer:
      "Here's what this generally means: the Hindu Marriage Act lets either spouse file for divorce on specific grounds, or both can file by mutual consent. What you can do: for mutual consent, you'd typically file jointly after living separately for a year, followed by a cooling-off period the court can sometimes waive. One thing to watch for: contested grounds like cruelty or desertion need evidence, so that changes how the case is built.",
    citations: [
      { label: "Hindu Marriage Act, 1955, s.13 (grounds for divorce)", sourceUrl: "https://www.indiacode.nic.in/", confidence: "verified" },
      { label: "Hindu Marriage Act, 1955, s.13B (mutual consent)", confidence: "verified" },
    ],
  },
  consumer: {
    answer:
      "Here's what this generally means: you can file a complaint with the District Consumer Disputes Redressal Commission, or online through the e-Daakhil portal. What you can do: keep your invoice, warranty card, and any written communication with the seller — those matter for the complaint. One thing to watch for: the forum you file in depends on the value of the claim, so that's worth checking before you file.",
    citations: [{ label: "Consumer Protection Act, 2019, s.34 (jurisdiction of District Commission)", confidence: "verified" }],
  },
  property: {
    answer:
      "Here's what this generally means: a landlord generally has to serve a valid notice before seeking possession, and the required notice period depends on the type of tenancy. What you can do: check whether your state's rent control law applies, since it can add protections beyond the central law. One thing to watch for: an invalid or too-short notice can itself be a ground to contest the eviction.",
    citations: [{ label: "Transfer of Property Act, 1882, s.106 (notice to quit)", confidence: "interpretation" }],
  },
  labour: {
    answer:
      "Here's what this generally means: if you're a 'workman' under the Industrial Disputes Act, your employer generally has to follow a specific retrenchment procedure before terminating you. What you can do: ask for the termination in writing and check whether the required notice and compensation were actually given. One thing to watch for: some categories of employees fall outside this protection, so that's worth confirming first.",
    citations: [{ label: "Industrial Disputes Act, 1947, s.25F (conditions precedent to retrenchment)", confidence: "verified" }],
  },
  constitutional: {
    answer:
      "Here's what this generally means: Article 226 lets you approach a High Court directly when a fundamental or other legal right is violated by state action. What you can do: a writ petition can move faster than a regular suit in the right circumstances. One thing to watch for: courts sometimes expect you to try other available remedies first, so that can affect whether the court entertains it immediately.",
    citations: [{ label: "Constitution of India, Art. 226 (writ jurisdiction of High Courts)", confidence: "verified" }],
  },
  civil: {
    answer:
      "I don't have a reliable source for a precise answer to this in the demo corpus. In general, civil disputes are resolved through a suit filed in the court with jurisdiction over the subject matter and location. One thing to watch for: deadlines (limitation periods) can bar a claim entirely, so that's worth checking early with an advocate.",
    citations: [{ label: "No reliable source found for this specific question in demo mode", confidence: "none" }],
  },
};

export function getDemoAnswer(domain: string): DomainAnswer {
  return DOMAIN_ANSWERS[domain] ?? DOMAIN_ANSWERS.civil;
}

// Best-matching domain for a question, used to decide whether to hand off to another lawyer.
// Demo-only heuristic — mirrors the one in matchApi.ts but returns just the domain.
export function detectDomain(text: string): string | null {
  const lower = text.toLowerCase();
  for (const lawyer of inKeywordMatchOrder(DEMO_LAWYERS)) {
    if (lawyer.keywords.some((k) => lower.includes(k))) return lawyer.domain;
  }
  return null;
}
