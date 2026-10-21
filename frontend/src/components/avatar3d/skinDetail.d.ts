import type { DataTexture, Object3D, WebGLRenderer } from "three";

export interface SkinDetailOptions {
  /** Master switch (default true). */
  enabled?: boolean;
  /** How many times the detail tile repeats across the mesh UVs. */
  detailRepeat?: number;
  /** Detail-normal strength on the face. */
  detailStrength?: number;
  /** Detail-normal strength on AvatarBody. */
  bodyStrength?: number;
  /** +- roughness modulation driven by the detail height. */
  roughnessVariation?: number;
  /** Sheen intensity; 0 disables it. */
  sheen?: number;
  /** Sheen lobe width; lower keeps it to grazing angles. */
  sheenRoughness?: number;
  /** Sheen colour as 0xRRGGBB. */
  sheenColor?: number;
  /** Procedural photographic layer on the face (default true). */
  photographic?: boolean;
  /** Blotchy hue/lightness variation, 0..2 (default 1). */
  colourVariation?: number;
  /** Warmth on cheeks, nose tip and ear rims, 0..2 (default 1). */
  cheekRedness?: number;
  /** Sparse freckles on the nose bridge and cheeks, 0..2 (default 0). */
  freckles?: number;
  /** Faint cool tint at temples / under the eyes and redness at the nostril wings, 0..2 (default 0.5). */
  capillaries?: number;
  /** Needed to centre the photographic layer (one 256 px probe render at load). Without it the layer is not centred. */
  renderer?: WebGLRenderer | null;
  /** Per-avatar seed so every face varies differently. */
  seed?: number;
  /** 1 = show the zone mask, 2 = show the colour change x10 (diagnostics only). */
  debug?: number;
}

export interface SkinDetailSummary {
  enabled: boolean;
  /** "<mesh name>:<material name>" for every enhanced mesh. */
  meshes: string[];
  /** Meshes that also got the photographic layer. */
  photographic: string[];
}

/** Adds pores, micro-variation and a faint sheen to the avatar's skin materials. Never touches albedo. */
export function enhanceSkin(avatarRoot: Object3D, options?: SkinDetailOptions): SkinDetailSummary;

/** The shared, cached, tileable detail normal map (RGB normal, A height). */
export function getSkinDetailTexture(): DataTexture;

/** False on low-power devices (<= 4 cores with a coarse pointer or small screen). */
export function shouldEnableSkinDetail(): boolean;
