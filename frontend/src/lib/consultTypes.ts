export type SourceConfidence = "verified" | "interpretation" | "none";

export interface Citation {
  label: string;
  sourceUrl?: string;
  confidence: SourceConfidence;
}

export type ConsultStatus = "idle" | "listening" | "processing" | "speaking";

export interface TranscriptTurn {
  id: string;
  role: "user" | "lawyer";
  text: string;
  citations?: Citation[];
}
