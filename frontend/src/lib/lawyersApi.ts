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
    keywords: [],
  };
}

// Backend contract (proposed, not built yet): GET /lawyers -> see BackendLawyer above.
export async function getLawyers(): Promise<Lawyer[]> {
  if (!API_URL) return DEMO_LAWYERS;
  const res = await fetch(`${API_URL}/lawyers`);
  if (!res.ok) throw new Error(`GET /lawyers failed: ${res.status}`);
  const data: BackendLawyer[] = await res.json();
  return data.map(mapBackendLawyer);
}

export async function getLawyer(id: string): Promise<Lawyer | undefined> {
  const lawyers = await getLawyers();
  return lawyers.find((l) => l.id === id);
}
