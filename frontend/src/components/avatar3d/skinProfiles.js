// Per-lawyer skin profiles for the photographic layer in skinDetail.js. Plain JS (no imports) so the Vite app, the headshot
// script (Node) and the headshot page can all read the same table.
//
// Every intensity is a multiplier on a deliberately small base effect (0 = off, 1 = the default look, 2 = double), and the
// seed makes each avatar's blotches, freckles and tints fall in different places. Defaults: subtle colour variation and cheek
// warmth on all six; light freckles on the three female avatars; none on the male avatars (they didn't look natural there).

/** @type {import("./skinDetail").SkinDetailOptions} */
export const DEFAULT_SKIN_PROFILE = {
  colourVariation: 1,
  cheekRedness: 1,
  freckles: 0,
  capillaries: 0.5,
  seed: 1,
};

/** @type {Record<string, import("./skinDetail").SkinDetailOptions>} keyed by lawyer id (see lawyerModels.ts) */
export const SKIN_PROFILES = {
  criminal: { colourVariation: 1, cheekRedness: 1, freckles: 0.5, capillaries: 0.5, seed: 11 }, // Rhea Kapoor
  family: { colourVariation: 1, cheekRedness: 1.1, freckles: 0.45, capillaries: 0.45, seed: 23 }, // Meera Nair
  constitutional: { colourVariation: 1, cheekRedness: 1, freckles: 0.4, capillaries: 0.5, seed: 37 }, // Ananya Iyer
  property: { colourVariation: 1, cheekRedness: 0.9, freckles: 0, capillaries: 0.6, seed: 41 }, // Vikram Menon
  labour: { colourVariation: 1.15, cheekRedness: 0.9, freckles: 0, capillaries: 0.8, seed: 53 }, // Karan Oberoi
  // Arjun Shah (ArjunShah.glb). The pore-detail tile is shifted to 22 repeats and the cheek warmth lowered: on this skin map the default
  // pattern landed brighter than the original exactly where the tone check samples the cheeks (+0.058 in red), outside the +-0.03 budget.
  consumer: { detailRepeat: 22, colourVariation: 1, cheekRedness: 0.25, freckles: 0, capillaries: 0.5, seed: 67 },
};
