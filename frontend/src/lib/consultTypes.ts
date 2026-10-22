export type SourceConfidence = "verified" | "interpretation" | "none";

export interface Citation {
  /** The [n] marker this source carries in the answer text (backend answers only). */
  marker?: number;
  label: string;
  sourceUrl?: string;
  confidence: SourceConfidence;
}

export type ConsultStatus = "idle" | "listening" | "processing" | "speaking";

/** A lawyer turn that is not a sourced answer: the in-app intro (greeting / help request) or a refusal ("no reliable source"). */
export type TurnKind = "intro" | "refusal";

export interface TranscriptTurn {
  id: string;
  role: "user" | "lawyer";
  text: string;
  citations?: Citation[];
  kind?: TurnKind;
  /** Starter questions offered under this turn (shown while it is the latest one): all of them after an intro, up to 3 after a refusal. */
  suggestions?: string[];
  /** A general-guidance answer: shown with a tag and muted, no citations (docs/CONTRACTS.md, tier 2). */
  general?: boolean;
}
