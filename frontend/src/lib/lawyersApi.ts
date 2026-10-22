import { DEMO_LAWYERS, type Lawyer } from "./demoLawyers";

// The order every list of advocates is shown in (Home grid, "Other advocates", ...).
// Ids not listed here go last, in the order received.
const LAWYER_ORDER = ["criminal", "property", "labour", "constitutional", "consumer", "family"];
const orderRank = (id: string) => {
  const i = LAWYER_ORDER.indexOf(id);
  return i === -1 ? LAWYER_ORDER.length : i;
};
const inDisplayOrder = (lawyers: Lawyer[]): Lawyer[] => [...lawyers].sort((a, b) => orderRank(a.id) - orderRank(b.id)); // stable sort

// Names, avatars and personas are the frontend's own (demoLawyers.ts). The backend's GET /lawyers only returns
// "TBD" placeholders, so it is not called; the backend is asked questions by lawyer.domain (see askApi.ts).
export async function getLawyers(): Promise<Lawyer[]> {
  return inDisplayOrder(DEMO_LAWYERS);
}

export async function getLawyer(id: string): Promise<Lawyer | undefined> {
  const lawyers = await getLawyers();
  return lawyers.find((l) => l.id === id);
}
