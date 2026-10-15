// Placeholder persona data for demo mode, shaped like the proposed GET /lawyers response.
// Area 4 owns the real personas — see "Changes needed outside frontend/".
export interface Lawyer {
  id: string;
  name: string;
  domain: string;
  practice: string; // short label shown under the portrait, e.g. "Family & Divorce"
  tagline: string;
  description: string;
  experience: string; // the persona's described background — never real-sounding credentials
  specializations: string[];
  languages: string[];
  avatarUrl?: string;
  sampleAudioUrl?: string;
  keywords: string[]; // demo-only /match helper; not part of the real backend contract
}

export const DEMO_LAWYERS: Lawyer[] = [
  {
    id: "criminal",
    name: "Adv. Rhea Kapoor",
    domain: "criminal",
    practice: "Criminal Law",
    tagline: "FIRs, bail, and criminal procedure",
    description:
      "Rhea focuses on the practical first steps after an arrest or FIR: what the process looks like, what your rights are at each stage, and how bail applications typically proceed.",
    experience: "Persona background: shaped around criminal procedure matters handled in trial and sessions courts.",
    specializations: ["FIR & arrest procedure", "Bail applications", "Cognizable vs. non-cognizable offences"],
    languages: ["English", "Hindi"],
    keywords: ["fir", "police", "arrest", "bail", "theft", "assault", "crime"],
  },
  {
    id: "family",
    name: "Adv. Meera Iyer",
    domain: "family",
    practice: "Family & Divorce",
    tagline: "Divorce, custody, and maintenance",
    description:
      "Meera explains family law matters in plain language — divorce grounds and process, child custody considerations, and maintenance — with a calm, patient approach.",
    experience: "Persona background: shaped around contested and mutual-consent family law matters.",
    specializations: ["Divorce (contested & mutual consent)", "Child custody", "Maintenance & alimony"],
    languages: ["English", "Hindi"],
    keywords: ["divorce", "marriage", "custody", "maintenance", "spouse", "husband", "wife"],
  },
  {
    id: "consumer",
    name: "Adv. Arjun Shah",
    domain: "consumer",
    practice: "Consumer Protection",
    tagline: "Refunds, warranties, and consumer forums",
    description:
      "Arjun is direct and practical on consumer disputes: defective products, refused refunds, warranty claims, and how to approach a consumer forum.",
    experience: "Persona background: shaped around consumer complaint and e-commerce dispute matters.",
    specializations: ["Defective goods & refunds", "Warranty disputes", "Consumer forum filings"],
    languages: ["English"],
    keywords: ["refund", "warranty", "defective", "product", "consumer", "seller", "ecommerce"],
  },
  {
    id: "property",
    name: "Adv. Priya Menon",
    domain: "property",
    practice: "Civil & Property",
    tagline: "Civil disputes, property, and tenancy",
    description:
      "Priya is thorough and methodical on property and tenancy matters — notices to quit, possession disputes, and landlord/tenant rights.",
    experience: "Persona background: shaped around civil property and tenancy disputes.",
    specializations: ["Landlord/tenant disputes", "Possession & eviction notices", "Property title issues"],
    languages: ["English", "Hindi"],
    keywords: ["property", "tenant", "landlord", "rent", "land", "possession", "eviction"],
  },
  {
    id: "labour",
    name: "Adv. Karan Oberoi",
    domain: "labour",
    practice: "Employment Law",
    tagline: "Wages, termination, and workplace disputes",
    description:
      "Karan takes a firm, employee-focused approach to wage disputes, wrongful termination, and workplace grievances.",
    experience: "Persona background: shaped around industrial and employment dispute matters.",
    specializations: ["Wrongful termination", "Unpaid wages", "Retrenchment compensation"],
    languages: ["English", "Hindi"],
    keywords: ["salary", "wages", "fired", "terminated", "employer", "employee", "workplace"],
  },
  {
    id: "constitutional",
    name: "Adv. Ananya Iyer",
    domain: "constitutional",
    practice: "Constitutional Law",
    tagline: "Fundamental rights and constitutional remedies",
    description:
      "Ananya is precise and big-picture on constitutional remedies — when and how a writ petition can protect a fundamental right.",
    experience: "Persona background: shaped around constitutional and writ matters.",
    specializations: ["Writ petitions", "Fundamental rights", "Public interest matters"],
    languages: ["English"],
    keywords: ["fundamental right", "writ", "constitution", "freedom of speech"],
  },
];
