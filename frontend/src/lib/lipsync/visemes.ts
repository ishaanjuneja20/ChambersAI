// The 15 standard visemes and how each one is built from the ARKit blendshapes the lawyer GLBs actually
// have (Ready Player Me head: jawOpen, mouthClose, mouthFunnel, mouthPucker, mouthRoll*, mouthPress*,
// mouthStretch*, mouthUpperUp*, mouthLowerDown*, mouthShrug*, mouthSmile*...). The GLBs have no viseme_*
// targets and no tongue, so TH, DD, nn and kk can only differ by jaw and lip opening.
// Each recipe was checked by rendering it on Ananya's face (see DECISIONS.md, 2026-10-20).
export const VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"] as const;
export type Viseme = (typeof VISEMES)[number];

type Recipe = Record<string, number>;

// "mouthSmile" etc. without a side expand to both Left and Right targets.
const PAIRED = ["mouthSmile", "mouthStretch", "mouthUpperUp", "mouthLowerDown", "mouthPress", "mouthDimple", "mouthFrown"];

function expand(recipe: Recipe): Recipe {
  const out: Recipe = {};
  for (const [key, value] of Object.entries(recipe)) {
    if (PAIRED.includes(key)) {
      out[`${key}Left`] = value;
      out[`${key}Right`] = value;
    } else out[key] = value;
  }
  return out;
}

export const VISEME_RECIPES: Record<Viseme, Recipe> = {
  sil: {},
  // Lips sealed and slightly pressed: mouthClose cancels the lip part of jawOpen.
  PP: expand({ jawOpen: 0.07, mouthClose: 0.07, mouthPress: 0.45, mouthRollLower: 0.2, mouthRollUpper: 0.12 }),
  // Lower lip tucked up under the upper teeth.
  FF: expand({ jawOpen: 0.1, mouthRollLower: 0.6, mouthUpperUp: 0.25, mouthShrugLower: 0.15 }),
  TH: expand({ jawOpen: 0.17, mouthUpperUp: 0.2, mouthLowerDown: 0.2, mouthStretch: 0.1 }),
  DD: expand({ jawOpen: 0.2, mouthUpperUp: 0.15, mouthLowerDown: 0.18, mouthStretch: 0.15 }),
  kk: expand({ jawOpen: 0.27, mouthStretch: 0.22, mouthLowerDown: 0.15 }),
  // sh / ch / j: lips pushed forward, teeth nearly together.
  CH: expand({ jawOpen: 0.12, mouthFunnel: 0.5, mouthPucker: 0.15, mouthUpperUp: 0.2, mouthLowerDown: 0.22 }),
  // s / z: teeth together, lips apart and slightly spread.
  SS: expand({ jawOpen: 0.05, mouthStretch: 0.32, mouthSmile: 0.1, mouthUpperUp: 0.25, mouthLowerDown: 0.25 }),
  nn: expand({ jawOpen: 0.17, mouthStretch: 0.12, mouthUpperUp: 0.12, mouthLowerDown: 0.1 }),
  RR: expand({ jawOpen: 0.15, mouthFunnel: 0.32, mouthPucker: 0.3 }),
  aa: expand({ jawOpen: 0.55, mouthLowerDown: 0.25, mouthUpperUp: 0.08 }),
  E: expand({ jawOpen: 0.32, mouthStretch: 0.32, mouthSmile: 0.15, mouthLowerDown: 0.2, mouthUpperUp: 0.1 }),
  I: expand({ jawOpen: 0.18, mouthStretch: 0.42, mouthSmile: 0.28, mouthUpperUp: 0.15, mouthLowerDown: 0.15 }),
  O: expand({ jawOpen: 0.36, mouthFunnel: 0.6, mouthPucker: 0.18 }),
  U: expand({ jawOpen: 0.08, mouthPucker: 0.8, mouthFunnel: 0.28 }),
};

// Every morph target any viseme touches; the animator eases each of these every frame.
export const MOUTH_MORPHS: string[] = [...new Set(Object.values(VISEME_RECIPES).flatMap((r) => Object.keys(r)))];

// Shapes where the lips must fully reach their target (closure / lip-teeth contact), so they get a
// faster attack and are not scaled down by loudness.
export const CONTACT_VISEMES = new Set<Viseme>(["PP", "FF"]);
export const VOWEL_VISEMES = new Set<Viseme>(["aa", "E", "I", "O", "U"]);
