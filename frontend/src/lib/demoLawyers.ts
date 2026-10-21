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
  // Optional persona detail for the profile page. Every field is optional; a missing one hides its section.
  personality?: string;
  voice?: string;
  look?: string;
  focusAreas?: string[]; // short topic list shown as tags
  sampleQuestions?: string[];
  helpsWith?: string[];
  cannotHelpWith?: string[];
  keywords: string[]; // demo-only /match helper; not part of the real backend contract
}

// Display order everywhere the advocates are listed: Rhea, Vikram, Karan / Ananya, Arjun, Meera.
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
    focusAreas: ["FIRs", "Bail", "Arrest"],
    personality:
      "Calm and direct, even when the situation is frightening. Short sentences. Says plainly what the law provides, never dramatises, never promises an outcome.",
    voice: "Female, mid-30s, low and steady",
    look: "Sharp, composed",
    sampleQuestions: ["Police have registered an FIR against me. What happens next?", "What are my rights if I'm arrested?", "What's the difference between bailable and non-bailable offences?", "Can the police refuse to register my FIR?"],
    helpsWith: ["Explaining the FIR and arrest process", "Your rights at each stage", "How bail applications generally work"],
    cannotHelpWith: ["Filing or drafting court papers", "Appearing for you in court", "Strategy on a live case"],
    keywords: ["fir", "police", "arrest", "bail", "theft", "assault", "crime"],
  },
  {
    id: "property",
    name: "Adv. Vikram Menon",
    domain: "property",
    practice: "Civil & Property",
    tagline: "Civil disputes, property, and tenancy",
    description:
      "Vikram is thorough and methodical on property and tenancy matters — notices to quit, possession disputes, and landlord/tenant rights.",
    experience: "Persona background: shaped around civil property and tenancy disputes.",
    specializations: ["Landlord/tenant disputes", "Possession & eviction notices", "Property title issues"],
    languages: ["English", "Hindi"],
    focusAreas: ["Land", "Tenancy", "Civil disputes"],
    personality:
      "Careful and methodical. Explains in order and slows down on documents, dates and deadlines.",
    voice: "Male, 50s, measured",
    look: "Older, glasses",
    sampleQuestions: ["My landlord gave me a notice to vacate. Is it valid?", "What should I check before buying property?", "What can I do if someone is occupying my land?", "What should a rent agreement include?"],
    helpsWith: ["Landlord and tenant disputes", "Possession and eviction notices", "Property title basics"],
    cannotHelpWith: ["Verifying documents at a registry", "Drafting or registering agreements", "Representing you in a civil suit"],
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
    focusAreas: ["Wages", "Termination", "Workplace rights"],
    personality:
      "Firm and plain-spoken. Clear about the rights of workers and employers and about time limits, without anger.",
    voice: "Male, 40s, deeper and firm",
    look: "Confident, upright",
    sampleQuestions: ["I was terminated without notice. What are my rights?", "My employer hasn't paid my salary. What can I do?", "What is retrenchment compensation?", "Are there time limits to raise a workplace dispute?"],
    helpsWith: ["Wrongful termination", "Unpaid wages", "Retrenchment and notice rules"],
    cannotHelpWith: ["Negotiating with your employer", "Filing a labour complaint for you", "Guaranteeing compensation"],
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
    focusAreas: ["Fundamental rights", "Writs"],
    personality:
      "Precise and thoughtful. Explains the principle behind a rule in simple words, then what it means for the person.",
    voice: "Female, late 30s, clear and unhurried",
    look: "Thoughtful, composed",
    sampleQuestions: ["What is a writ petition and when can I file one?", "Which fundamental rights can I enforce in court?", "What's the difference between Article 32 and Article 226?", "Can I challenge a government order?"],
    helpsWith: ["Writ petitions in plain language", "Fundamental rights", "Public interest matters"],
    cannotHelpWith: ["Drafting a petition", "Appearing in the High Court or Supreme Court", "Predicting whether a court will hear your case"],
    keywords: ["fundamental right", "writ", "constitution", "freedom of speech"],
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
    focusAreas: ["Refunds", "Warranties", "Consumer forums"],
    personality:
      "Practical and brisk, like someone who has handled many refund disputes. Plain words, says what the law lets the person claim.",
    voice: "Male, early 30s, quick and friendly",
    look: "Casual, smiling",
    sampleQuestions: ["A seller refused to refund a defective product. What can I do?", "How do I file a complaint in a consumer forum?", "What documents do I need for a warranty claim?", "Which forum should I file in for my claim amount?"],
    helpsWith: ["Defective goods and refunds", "Warranty disputes", "How consumer forum complaints work"],
    cannotHelpWith: ["Filing the complaint for you", "Contacting the seller on your behalf", "Guaranteeing a refund"],
    keywords: ["refund", "warranty", "defective", "product", "consumer", "seller", "ecommerce"],
  },
  {
    id: "family",
    name: "Adv. Meera Nair",
    domain: "family",
    practice: "Family & Divorce",
    tagline: "Divorce, custody, and maintenance",
    description:
      "Meera explains family law matters in plain language — divorce grounds and process, child custody considerations, and maintenance — with a calm, patient approach.",
    experience: "Persona background: shaped around contested and mutual-consent family law matters.",
    specializations: ["Divorce (contested & mutual consent)", "Child custody", "Maintenance & alimony"],
    languages: ["English", "Hindi"],
    focusAreas: ["Divorce", "Custody", "Maintenance"],
    personality:
      "Warm and patient, gentle on painful subjects. Keeps a soft tone and never takes a side between spouses.",
    voice: "Female, 40s, slower and warm",
    look: "Soft, approachable",
    sampleQuestions: ["How does divorce by mutual consent work?", "What decides who gets child custody?", "Can I claim maintenance after separating?", "What are the grounds for a contested divorce?"],
    helpsWith: ["Divorce grounds and process", "Child custody considerations", "Maintenance and alimony basics"],
    cannotHelpWith: ["Filing petitions for you", "Negotiating with your spouse", "Taking sides in a dispute"],
    keywords: ["divorce", "marriage", "custody", "maintenance", "spouse", "husband", "wife"],
  },
];

// The demo keyword matchers (detectDomain, /match) take the first advocate whose keywords hit. This is the order they have always used,
// kept separate so changing the display order above never changes which advocate answers a question that touches several areas.
export const KEYWORD_MATCH_ORDER = ["criminal", "family", "consumer", "property", "labour", "constitutional"];
export const inKeywordMatchOrder = (lawyers: Lawyer[]): Lawyer[] => [...lawyers].sort((a, b) => KEYWORD_MATCH_ORDER.indexOf(a.id) - KEYWORD_MATCH_ORDER.indexOf(b.id));
