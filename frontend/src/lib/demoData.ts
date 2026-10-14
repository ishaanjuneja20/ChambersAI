import type { Citation, LawyerEntry, SessionSummaryItem, CaseSummary, TimelineEvent, EvidenceItem, ExtractedFact } from "./contract";

// Mirrors the real lawyers.json shape (backend `deploy/oracle`), filled in with demo
// names/taglines since the real file currently has every field set to "TBD".
export const DEMO_LAWYERS: (LawyerEntry & { tagline: string; languages: Lang_[]; sampleAudioUrl?: string })[] = [
  { id: "criminal", name: "Advocate Rhea Kapoor", domain: "criminal", personality: "Direct, calm under pressure", voice_id: "voice-criminal", avatar: "/avatars/placeholder.svg", tagline: "FIRs, bail, and criminal procedure", languages: ["en", "hi"] },
  { id: "family", name: "Advocate Meera Nair", domain: "family", personality: "Warm, patient listener", voice_id: "voice-family", avatar: "/avatars/placeholder.svg", tagline: "Divorce, custody, and maintenance", languages: ["en", "hi"] },
  { id: "consumer", name: "Advocate Arjun Shah", domain: "consumer", personality: "Practical, to the point", voice_id: "voice-consumer", avatar: "/avatars/placeholder.svg", tagline: "Refunds, warranties, and consumer forums", languages: ["en", "hi"] },
  { id: "property", name: "Advocate Priya Menon", domain: "property", personality: "Thorough and methodical", voice_id: "voice-property", avatar: "/avatars/placeholder.svg", tagline: "Civil disputes, property, and tenancy", languages: ["en"] },
  { id: "labour", name: "Advocate Karan Oberoi", domain: "labour", personality: "Firm advocate for the employee", voice_id: "voice-labour", avatar: "/avatars/placeholder.svg", tagline: "Wages, termination, and workplace disputes", languages: ["en", "hi"] },
  { id: "constitutional", name: "Advocate Ananya Iyer", domain: "constitutional", personality: "Precise, big-picture thinker", voice_id: "voice-constitutional", avatar: "/avatars/placeholder.svg", tagline: "Fundamental rights and constitutional remedies", languages: ["en"] },
];

type Lang_ = "en" | "hi";

export function demoMatch(text: string): { lawyerId: string; reason: string } {
  const lower = text.toLowerCase();
  const rules: { domain: string; keywords: string[] }[] = [
    { domain: "criminal", keywords: ["fir", "police", "arrest", "bail", "theft", "assault", "murder", "crime"] },
    { domain: "family", keywords: ["divorce", "marriage", "custody", "maintenance", "spouse", "husband", "wife"] },
    { domain: "consumer", keywords: ["refund", "warranty", "defective", "product", "consumer", "seller", "ecommerce"] },
    { domain: "property", keywords: ["property", "tenant", "landlord", "rent", "land", "possession", "eviction"] },
    { domain: "labour", keywords: ["salary", "wages", "fired", "terminated", "employer", "employee", "workplace"] },
    { domain: "constitutional", keywords: ["fundamental right", "writ", "constitution", "freedom of speech"] },
  ];
  for (const rule of rules) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      const lawyer = DEMO_LAWYERS.find((l) => l.domain === rule.domain)!;
      return { lawyerId: lawyer.id, reason: `Your description mentions ${rule.keywords.find((k) => lower.includes(k))}, which falls under ${lawyer.domain} law.` };
    }
  }
  return { lawyerId: "civil", reason: "Based on your description, this looks like a general civil matter." };
}

const DEMO_CITATIONS: Record<string, Citation[]> = {
  criminal: [
    { label: "Bharatiya Nyaya Sanhita, 2023 s.103 (murder)", kind: "statute", verification: "verified", source_url: "https://www.indiacode.nic.in/" },
    { label: "Bharatiya Nagarik Suraksha Sanhita, 2023 s.173 (FIR registration)", kind: "statute", verification: "verified" },
  ],
  family: [
    { label: "Hindu Marriage Act, 1955 s.13 (grounds for divorce)", kind: "statute", verification: "verified", source_url: "https://www.indiacode.nic.in/" },
  ],
  consumer: [
    { label: "Consumer Protection Act, 2019 s.2(7) (consumer forum jurisdiction)", kind: "statute", verification: "verified" },
  ],
  property: [
    { label: "Transfer of Property Act, 1882 s.106 (notice to quit)", kind: "statute", verification: "interpretation" },
  ],
  labour: [
    { label: "Industrial Disputes Act, 1947 s.25F (retrenchment compensation)", kind: "statute", verification: "verified" },
  ],
  constitutional: [
    { label: "Constitution of India, Art. 226 (writ jurisdiction of High Courts)", kind: "statute", verification: "verified" },
  ],
  civil: [],
};

export function demoCitationsFor(domain: string): Citation[] {
  return DEMO_CITATIONS[domain] ?? [];
}

export function demoAnswer(domain: string, _question: string): { answer: string; citations: Citation[] } {
  const citations = demoCitationsFor(domain);
  const answers: Record<string, string> = {
    criminal: "In general, you (or anyone with knowledge of a cognizable offence) can file an FIR at the police station that has jurisdiction over where the offence occurred. The police are required to register it and give you a copy free of cost. If they refuse, you can approach the Superintendent of Police or move the jurisdictional Magistrate under BNSS s.175(3). This is general information, not legal advice for your specific case.",
    family: "Under the Hindu Marriage Act, either spouse can file for divorce on specific grounds such as cruelty, desertion for two years, or mutual consent. A mutual consent divorce under s.13B generally requires a one-year separation and a cooling-off period of six months after filing, though courts can waive this in some circumstances. This is general information, not legal advice for your specific case.",
    consumer: "You can file a complaint with the District Consumer Disputes Redressal Commission if the value of goods/services and compensation claimed is within its pecuniary jurisdiction. Complaints can also be filed online via the e-Daakhil portal. Keep your invoice, warranty card, and any written communication with the seller. This is general information, not legal advice for your specific case.",
    property: "A landlord generally must serve a valid notice to quit under s.106 of the Transfer of Property Act before seeking possession, with the notice period depending on the nature of the tenancy. State-specific rent control laws may also apply and can offer tenants additional protection. This is general information, not legal advice for your specific case.",
    labour: "An employer terminating a 'workman' as defined under the Industrial Disputes Act generally must follow the retrenchment procedure under s.25F, including notice, compensation, and informing the appropriate government authority, unless an exception applies. This is general information, not legal advice for your specific case.",
    constitutional: "Article 226 lets you approach a High Court directly for a writ when a fundamental right or other legal right is violated by state action, without necessarily exhausting every other remedy first, although courts can ask you to pursue alternate remedies first in some situations. This is general information, not legal advice for your specific case.",
    civil: "I don't have a reliable source for a precise answer to this in the demo corpus. In general, civil disputes in India are resolved through a civil suit in the court with jurisdiction over the subject matter and location. Please consult an advocate for advice specific to your situation.",
  };
  return { answer: answers[domain] ?? answers.civil, citations };
}

export const DEMO_SESSIONS: SessionSummaryItem[] = [
  { id: "s1", lawyerId: "family", lawyerName: "Advocate Meera Nair", domain: "family", title: "Divorce by mutual consent", createdAt: "2026-10-01T10:00:00Z", lastMessage: "What documents do I need to file?" },
  { id: "s2", lawyerId: "consumer", lawyerName: "Advocate Arjun Shah", domain: "consumer", title: "Refund for defective phone", createdAt: "2026-10-05T14:30:00Z", lastMessage: "Can I file this on the e-Daakhil portal?" },
];

export const DEMO_CASE_SUMMARY: CaseSummary = {
  keyFacts: ["User purchased a phone online on 2026-09-20.", "The phone stopped working within 10 days.", "The seller has refused a refund, offering only a repair."],
  legalSources: demoCitationsFor("consumer"),
  dates: [{ label: "Purchase date", date: "2026-09-20" }, { label: "Complaint raised with seller", date: "2026-09-30" }],
  missingInformation: ["Invoice number", "Whether the product was under manufacturer warranty"],
  nextSteps: ["Send a written complaint to the seller via email, keeping a copy.", "If unresolved in 15 days, file a complaint on the e-Daakhil portal.", "Consult an advocate before filing if the claim amount is large."],
};

export const DEMO_TIMELINE: TimelineEvent[] = [
  { id: "t1", date: "2026-09-20", description: "Product purchased" },
  { id: "t2", date: "2026-09-30", description: "Complaint raised with seller" },
  { id: "t3", date: "2026-10-05", description: "Seller offered repair only" },
];

export const DEMO_EVIDENCE: EvidenceItem[] = [
  { id: "e1", label: "Purchase invoice", status: "have" },
  { id: "e2", label: "Photos/video of the defect", status: "needs_confirmation" },
  { id: "e3", label: "Written communication with seller", status: "missing" },
];

export const DEMO_FACTS: ExtractedFact[] = [
  { id: "f1", text: "Purchase amount: Rs. 24,999", sourceDocument: "invoice.pdf", type: "amount" },
  { id: "f2", text: "Purchase date: 2026-09-20", sourceDocument: "invoice.pdf", type: "date" },
  { id: "f3", text: "Seller: ElectroMart Pvt Ltd", sourceDocument: "invoice.pdf", type: "party" },
  { id: "f4", text: "Warranty period not stated on invoice", sourceDocument: "invoice.pdf", type: "fact", flagged: "missing" },
];
