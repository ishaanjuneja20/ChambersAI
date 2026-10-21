import { DEMO_LAWYERS, type Lawyer } from "./demoLawyers";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface BackendLawyer {
  id: string;
  name: string;
  domain: string;
  tagline: string;
  description: string;
  experience: string;
  specializations: string[];
  languages: string[];
  avatar_url?: string;
  sample_audio_url?: string;
  // Optional persona detail; any field the backend omits simply hides that part of the profile page.
  personality?: string;
  voice?: string;
  look?: string;
  focus_areas?: string[];
  sample_questions?: string[];
  helps_with?: string[];
  cannot_help_with?: string[];
}

function mapBackendLawyer(l: BackendLawyer): Lawyer {
  return {
    id: l.id,
    name: l.name,
    domain: l.domain,
    practice: l.tagline,
    tagline: l.tagline,
    description: l.description,
    experience: l.experience,
    specializations: l.specializations,
    languages: l.languages,
    avatarUrl: l.avatar_url,
    sampleAudioUrl: l.sample_audio_url,
    personality: l.personality,
    voice: l.voice,
    look: l.look,
    focusAreas: l.focus_areas,
    sampleQuestions: l.sample_questions,
    helpsWith: l.helps_with,
    cannotHelpWith: l.cannot_help_with,
    keywords: [],
  };
}

// The order every list of advocates is shown in (Home grid, "Other advocates", ...), whatever order the backend returns them in.
// Ids not listed here go last, in the order received.
const LAWYER_ORDER = ["criminal", "property", "labour", "constitutional", "consumer", "family"];
const orderRank = (id: string) => {
  const i = LAWYER_ORDER.indexOf(id);
  return i === -1 ? LAWYER_ORDER.length : i;
};
const inDisplayOrder = (lawyers: Lawyer[]): Lawyer[] => [...lawyers].sort((a, b) => orderRank(a.id) - orderRank(b.id)); // stable sort

// Backend contract (proposed, not built yet): GET /lawyers -> see BackendLawyer above.
export async function getLawyers(): Promise<Lawyer[]> {
  if (!API_URL) return inDisplayOrder(DEMO_LAWYERS);
  const res = await fetch(`${API_URL}/lawyers`);
  if (!res.ok) throw new Error(`GET /lawyers failed: ${res.status}`);
  const data: BackendLawyer[] = await res.json();
  return inDisplayOrder(data.map(mapBackendLawyer));
}

export async function getLawyer(id: string): Promise<Lawyer | undefined> {
  const lawyers = await getLawyers();
  return lawyers.find((l) => l.id === id);
}
