// Lawyers that have a 3D avatar on the consultation screen. Everyone else keeps the 2D portrait.
// Ananya Iyer (constitutional), Vikram Menon (property), Karan Oberoi (labour), Arjun Shah (consumer) and
// Meera Nair (family) and Rhea Kapoor (criminal). All
// GLBs share the same Ready Player Me rig and ARKit blendshapes, so framing, arm pose (IK from each model's
// own bone lengths), visemes and face animation are shared.
import type { SkinDetailOptions } from "./skinDetail";
import { DEFAULT_SKIN_PROFILE, SKIN_PROFILES } from "./skinProfiles";
import versions from "./avatarVersions.json"; // short content hash per GLB, written by scripts/avatar-versions.mjs

export interface LawyerModel {
  modelUrl: string;
  fallbackUrls: string[]; // tried in order if modelUrl can't be loaded (e.g. KTX2 not decodable): the .hd.glb, then the original
  skinProfile: SkinDetailOptions; // intensities for the photographic skin layer (see skinProfiles.js)
  backgroundUrl: string;
  fishVoice: boolean; // speak with the backend's Fish Audio voice + lip-sync timing when VITE_TTS_API_URL is set
}

const base = import.meta.env.BASE_URL;

// One-line switches, from most to least preferred file. The original GLBs and the .hd.glb files are never modified.
//   USE_COMPRESSED_AVATARS  <Name>.opt.glb: KTX2 (UASTC / ETC1S) textures + meshopt geometry, built by scripts/compress-avatars.mjs
//   USE_HD_AVATARS          <Name>.hd.glb: 2048 px head-skin textures, built by scripts/build-hd-avatars.mjs
//   (both false)            the original <Name>.glb
// Set USE_COMPRESSED_AVATARS to false to go back to the uncompressed files. The headshot script reads USE_HD_AVATARS only: it
// always renders from the uncompressed source.
const USE_COMPRESSED_AVATARS = true;
const USE_HD_AVATARS = true;
// "?v=<hash>" changes whenever the file's content does, because /brand/assets/lawyers/* is served with an immutable cache header.
const variant = (path: string, suffix: string) => {
  const file = path.replace(/\.glb$/, `${suffix}.glb`);
  const hash = (versions as Record<string, string>)[file];
  return `${encodeURI(file)}${hash ? `?v=${hash}` : ""}`;
};
const candidates = (path: string) => [...(USE_COMPRESSED_AVATARS ? [".opt"] : []), ...(USE_HD_AVATARS ? [".hd"] : []), ""].map((suffix) => variant(path, suffix));
const glb = (path: string) => candidates(path)[0]; // the preferred file
const fallbacks = (path: string) => candidates(path).slice(1).map((url) => `${base}${url}`); // what to try if it fails to load

const LAWYER_MODELS: Record<string, LawyerModel> = {
  constitutional: {
    modelUrl: `${base}${glb("brand/assets/lawyers/Ananaya Iyer.glb")}`,
    fallbackUrls: fallbacks("brand/assets/lawyers/Ananaya Iyer.glb"),
    skinProfile: SKIN_PROFILES.constitutional ?? DEFAULT_SKIN_PROFILE,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true,
  },
  property: {
    modelUrl: `${base}${glb("brand/assets/lawyers/rheakapoor.glb")}`,
    fallbackUrls: fallbacks("brand/assets/lawyers/rheakapoor.glb"),
    skinProfile: SKIN_PROFILES.property ?? DEFAULT_SKIN_PROFILE,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "property"
  },
  labour: {
    modelUrl: `${base}${glb("brand/assets/lawyers/Karan oberoy.glb")}`,
    fallbackUrls: fallbacks("brand/assets/lawyers/Karan oberoy.glb"),
    skinProfile: SKIN_PROFILES.labour ?? DEFAULT_SKIN_PROFILE,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "labour" (male voice)
  },
  consumer: {
    modelUrl: `${base}${glb("brand/assets/lawyers/ArjunShah.glb")}`,
    fallbackUrls: fallbacks("brand/assets/lawyers/ArjunShah.glb"),
    skinProfile: SKIN_PROFILES.consumer ?? DEFAULT_SKIN_PROFILE,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "consumer" (male voice)
  },
  family: {
    modelUrl: `${base}${glb("brand/assets/lawyers/MeeraNair.glb")}`,
    fallbackUrls: fallbacks("brand/assets/lawyers/MeeraNair.glb"),
    skinProfile: SKIN_PROFILES.family ?? DEFAULT_SKIN_PROFILE,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "family"
  },
  criminal: {
    modelUrl: `${base}${glb("brand/assets/lawyers/priya_menon.glb")}`,
    fallbackUrls: fallbacks("brand/assets/lawyers/priya_menon.glb"),
    skinProfile: SKIN_PROFILES.criminal ?? DEFAULT_SKIN_PROFILE,
    backgroundUrl: `${base}assets/courtroom-background.png`,
    fishVoice: true, // backend/lawyers.py "criminal"; FISH_VOICE_CRIMINAL sets a female voice for Rhea
  },
};

export function getLawyerModel(lawyerId: string): LawyerModel | undefined {
  return LAWYER_MODELS[lawyerId];
}

export function usesFishVoice(lawyerId: string): boolean {
  return !!LAWYER_MODELS[lawyerId]?.fishVoice;
}
