// Fine skin detail (pores, faint micro-wrinkles, subtle sheen) for the Ready Player Me style avatars.
//
// Plain JS on purpose: it is imported both by the Vite app (CourtroomAvatar) and by the standalone headshot
// page served from the repo root, which resolves "three" through an importmap.
//
// HARD RULE: this never touches albedo. The base colour map, material colour and any tint are left exactly as
// the model ships them. The detail only perturbs the surface normal, nudges roughness, and adds a faint sheen.
import * as THREE from "three";

/**
 * @typedef {Object} SkinDetailOptions
 * @property {boolean} [enabled]          Master switch (default true).
 * @property {number} [detailRepeat]      How many times the detail tile repeats across the mesh UVs (default 24).
 * @property {number} [detailStrength]    Detail-normal strength on the face (default 0.45).
 * @property {number} [bodyStrength]      Detail-normal strength on AvatarBody (default 0.18).
 * @property {number} [roughnessVariation] +- roughness modulation from the detail height (default 0.08).
 * @property {number} [sheen]             Sheen intensity, 0 disables (default 0.03).
 * @property {number} [sheenRoughness]    Sheen lobe width; lower keeps it to grazing angles (default 0.25).
 * @property {number} [sheenColor]        Sheen colour as 0xRRGGBB (default warm 0xffc8a3).
 * @property {boolean} [photographic]     Procedural photographic layer on the face (default true). Albedo-path colour
 *                                        modulation, masked to the front facial skin; zero-mean so the complexion holds.
 * @property {number} [colourVariation]   Low-amplitude blotchy hue/lightness variation, 0..2 (default 1).
 * @property {number} [cheekRedness]      Warmth on the cheeks, nose tip and ear rims, 0..2 (default 1).
 * @property {number} [freckles]          Sparse soft freckles on the nose bridge and cheeks, 0..2 (default 0).
 * @property {number} [capillaries]       Faint cool tint at the temples / under the eyes and redness at the nostril wings, 0..2 (default 0.5).
 * @property {number} [seed]              Per-avatar seed so each face varies differently (default 1).
 * @property {THREE.WebGLRenderer} [renderer]  Needed to centre the photographic layer (a one-off 256 px probe render at load).
 * @property {number} [debug]             1 = show the zone mask (R live face, G excluded, B cheek+nose), 2 = show the colour change x10.
 */

/** @type {Required<SkinDetailOptions>} */
const DEFAULTS = {
  enabled: true,
  detailRepeat: 24,
  detailStrength: 0.45,
  bodyStrength: 0.18,
  roughnessVariation: 0.08,
  sheen: 0.03,
  sheenRoughness: 0.25,
  sheenColor: 0xffc8a3, // warm, so the faint extra light stays in the skin's own colour family
  photographic: true,
  colourVariation: 1,
  cheekRedness: 1,
  freckles: 0,
  capillaries: 0.5,
  seed: 1,
  renderer: null,
  debug: 0,
};

const TEXTURE_SIZE = 512;
const PROGRAM_KEY = "skinDetail-v2";
const SKIN_MATERIAL_NAMES = new Set(["AvatarHead", "AvatarBody"]);

// ---------------------------------------------------------------------------------------------------------
// Procedural, tileable detail map. Built once and shared by every avatar.
// ---------------------------------------------------------------------------------------------------------

/** @type {THREE.DataTexture | null} */
let sharedDetailTexture = null;

function hash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Value noise on a lattice with period (pu, pv); periodic, so the tile wraps seamlessly. */
function valueNoise(u, v, pu, pv, seed) {
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = smooth(u - iu);
  const fv = smooth(v - iv);
  const x0 = ((iu % pu) + pu) % pu;
  const y0 = ((iv % pv) + pv) % pv;
  const x1 = (x0 + 1) % pu;
  const y1 = (y0 + 1) % pv;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv; // 0..1
}

/** Pits: jittered points on a periodic grid, each a small smooth dimple. Returns <= 0. */
function pores(x, y, grid, seed) {
  const gx = x * grid;
  const gy = y * grid;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  let depth = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const px = cx + i;
      const py = cy + j;
      const wx = ((px % grid) + grid) % grid;
      const wy = ((py % grid) + grid) % grid;
      if (hash(wx, wy, seed + 11) > 0.6) continue; // ~60% of cells hold a pore
      const ox = px + 0.2 + 0.6 * hash(wx, wy, seed + 23);
      const oy = py + 0.2 + 0.6 * hash(wx, wy, seed + 37);
      const radius = 0.16 + 0.2 * hash(wx, wy, seed + 51);
      const d = Math.hypot(gx - ox, gy - oy) / radius;
      if (d >= 1) continue;
      const k = 1 - d * d;
      depth = Math.min(depth, -(0.55 + 0.45 * hash(wx, wy, seed + 67)) * k * k);
    }
  }
  return depth;
}

function buildHeight(size) {
  const h = new Float32Array(size * size);
  // Three faint stretched-noise fields at different angles read as fine, irregular skin lines, never a grid.
  const wrinkle = [
    { a: 1, b: 2, c: 2, d: -1, pu: 96, pv: 6, seed: 101 },
    { a: 2, b: -1, c: 1, d: 2, pu: 96, pv: 6, seed: 202 },
    { a: 3, b: 1, c: -1, d: 3, pu: 104, pv: 5, seed: 303 },
  ];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = i / size;
      const y = j / size;
      let micro = 0;
      let amp = 0.5;
      let total = 0;
      for (const f of [24, 48, 96, 192]) {
        micro += (valueNoise(x * f, y * f, f, f, f) - 0.5) * amp;
        total += amp;
        amp *= 0.55;
      }
      micro /= total;
      let lines = 0;
      for (const w of wrinkle) {
        const u = w.pu * (w.a * x + w.b * y);
        const v = w.pv * (w.c * x + w.d * y);
        const n = valueNoise(u, v, w.pu, w.pv, w.seed);
        lines += Math.max(0, 0.62 - Math.abs(n - 0.5) * 3.2) - 0.18; // thin ridges where the noise crosses 0.5
      }
      h[j * size + i] = 0.5 + 0.55 * micro + 0.5 * pores(x, y, 48, 7) + 0.06 * lines;
    }
  }
  return h;
}

/**
 * The shared detail map: RGB = tangent-space normal, A = height (drives the roughness variation).
 * Created lazily, once, and cached for every avatar.
 * @returns {THREE.DataTexture}
 */
export function getSkinDetailTexture() {
  if (sharedDetailTexture) return sharedDetailTexture;
  const size = TEXTURE_SIZE;
  const height = buildHeight(size);
  const data = new Uint8Array(size * size * 4);
  const at = (i, j) => height[((j + size) % size) * size + ((i + size) % size)];
  const slope = 5.5; // baked gradient gain; the per-material strength scales it at runtime
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * 0.5 * slope * size * 0.02;
      const dy = (at(i, j + 1) - at(i, j - 1)) * 0.5 * slope * size * 0.02;
      const len = Math.hypot(dx, dy, 1);
      const o = (j * size + i) * 4;
      data[o] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / len * 0.5 + 0.5) * 255);
      data[o + 3] = Math.round(Math.min(1, Math.max(0, height[j * size + i])) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8; // clamped to the GPU's maximum by three
  texture.colorSpace = THREE.NoColorSpace;
  texture.name = "skinDetailNormal";
  texture.needsUpdate = true;
  sharedDetailTexture = texture;
  return texture;
}

// ---------------------------------------------------------------------------------------------------------
// Facial-skin zones, built from the head mesh's own ARKit blendshapes
// ---------------------------------------------------------------------------------------------------------
//
// The mask for the photographic layer is built from three things:
//  1. the mesh itself: every ARKit blendshape stores how far each vertex moves, so the vertices that move most for the lip
//     shapes are the lips, for the eyelid and brow shapes the lids and brows, for the cheek / nostril shapes the cheeks and
//     the nose. Those become per-vertex values (normalised, then smoothed over the mesh so there is no visible boundary),
//     stored as the vertex attribute `aSkinZones` = (cheek, nose, lips, lids+brows). Built once per geometry.
//  2. head-relative landmarks: the eye bones give an origin and a unit (the inter-pupil distance), in which the shader draws
//     a face envelope (hairline above, chin below, cheekbones at the sides) so ears, neck and scalp are outside it.
//  3. the surface normal, so only forward-facing skin is affected (never the sides, back or underside).
// Positional guards keep each exclusion local, so the lip shapes (which also drag the chin) don't exclude the chin, and the
// brow shapes (which lift the forehead) don't exclude the forehead.

const ZONE_TARGETS = {
  cheek: ["cheekPuff", "cheekSquintLeft", "cheekSquintRight"],
  nose: ["noseSneerLeft", "noseSneerRight"],
  lips: ["mouthPucker", "mouthFunnel", "mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower", "mouthPressLeft", "mouthPressRight"],
  lids: ["eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight"],
  brows: ["browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight"],
};

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Per-vertex summed displacement over the named morph targets (all targets when names is null). */
function morphMagnitude(mesh, names) {
  const geo = mesh.geometry;
  const dict = mesh.morphTargetDictionary || {};
  const targets = geo.morphAttributes.position || [];
  const out = new Float32Array(geo.attributes.position.count);
  const indices = names ? names.filter((n) => n in dict).map((n) => dict[n]) : targets.map((_, i) => i);
  for (const i of indices) {
    const attr = targets[i];
    for (let v = 0; v < out.length; v++) out[v] += Math.hypot(attr.getX(v), attr.getY(v), attr.getZ(v));
  }
  return out;
}

function normalise(values) {
  const sorted = Float32Array.from(values).sort();
  const hi = sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1] || 1;
  for (let i = 0; i < values.length; i++) values[i] = Math.min(1, values[i] / hi);
  return values;
}

/** CSR vertex adjacency from the index buffer, for smoothing the zone values across the surface. */
function buildAdjacency(geo) {
  const n = geo.attributes.position.count;
  const idx = geo.index ? geo.index.array : null;
  const sets = Array.from({ length: n }, () => new Set());
  const tri = (a, b, c) => { sets[a].add(b).add(c); sets[b].add(a).add(c); sets[c].add(a).add(b); };
  if (idx) for (let i = 0; i < idx.length; i += 3) tri(idx[i], idx[i + 1], idx[i + 2]);
  else for (let i = 0; i < n; i += 3) tri(i, i + 1, i + 2);
  return sets.map((s) => Int32Array.from(s));
}

function relax(values, adjacency, passes) {
  let cur = values;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(cur.length);
    for (let v = 0; v < cur.length; v++) {
      const nb = adjacency[v];
      let sum = 0;
      for (let k = 0; k < nb.length; k++) sum += cur[nb[k]];
      next[v] = nb.length ? 0.5 * cur[v] + 0.5 * (sum / nb.length) : cur[v];
    }
    cur = next;
  }
  return cur;
}

/** Adds the `aSkinZones` attribute (cheek, nose, lips, lids+brows) to a head mesh's geometry (once). Returns false if the mesh has no facial blendshapes. */
function ensureSkinZones(mesh) {
  const geo = mesh.geometry;
  if (geo.getAttribute("aSkinZones")) return true;
  if (!geo.morphAttributes.position || !geo.morphAttributes.position.length || !mesh.morphTargetDictionary) return false;
  const adjacency = buildAdjacency(geo);
  const field = (names, passes) => relax(normalise(morphMagnitude(mesh, names)), adjacency, passes);
  const cheek = field(ZONE_TARGETS.cheek, 3);
  const nose = field(ZONE_TARGETS.nose, 2);
  const lips = field(ZONE_TARGETS.lips, 2);
  const lids = field(ZONE_TARGETS.lids, 2);
  const brows = field(ZONE_TARGETS.brows, 2);
  const n = cheek.length;
  const zones = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    zones[v * 4] = cheek[v];
    zones[v * 4 + 1] = nose[v];
    zones[v * 4 + 2] = lips[v];
    zones[v * 4 + 3] = Math.max(lids[v], brows[v]);
  }
  geo.setAttribute("aSkinZones", new THREE.BufferAttribute(zones, 4));
  return true;
}

/**
 * Head-relative frame in the mesh's own (bind-pose) space: the eye midpoint, the inter-pupil distance (the unit for all
 * zone coordinates, so one set of numbers fits every avatar) and the nose tip (the forward-most vertex near the midline).
 */
function headFrame(avatarRoot, mesh) {
  avatarRoot.updateMatrixWorld(true);
  const left = avatarRoot.getObjectByName("LeftEye");
  const right = avatarRoot.getObjectByName("RightEye");
  if (!left || !right) return null;
  const toLocal = (o) => {
    const p = o.getWorldPosition(new THREE.Vector3());
    return mesh.isSkinnedMesh ? p.applyMatrix4(mesh.bindMatrixInverse) : mesh.worldToLocal(p);
  };
  const a = toLocal(left);
  const b = toLocal(right);
  const eye = a.clone().add(b).multiplyScalar(0.5);
  const ipd = a.distanceTo(b);
  const pos = mesh.geometry.attributes.position;
  let tipZ = -Infinity;
  const tip = new THREE.Vector3();
  for (let v = 0; v < pos.count; v++) {
    const dx = (pos.getX(v) - eye.x) / ipd;
    const dy = (pos.getY(v) - eye.y) / ipd;
    if (Math.abs(dx) < 0.25 && dy < -0.15 && dy > -1.3 && pos.getZ(v) > tipZ) {
      tipZ = pos.getZ(v);
      tip.set(pos.getX(v), pos.getY(v), pos.getZ(v));
    }
  }
  return { eye, ipd, nose: tip.sub(eye).divideScalar(ipd) };
}

// ---------------------------------------------------------------------------------------------------------
// Shader patch (three r169 MeshPhysicalMaterial)
// ---------------------------------------------------------------------------------------------------------

// Single source of truth for the layer's strengths: used by the shader below AND by the CPU estimator that centres the layer's
// mean colour (so the two can't drift apart). Each entry is a small multiplicative change to the albedo.
const FX = {
  variation: { rgb: [0.022, -0.008, -0.016], light: 0.012 }, // blotchy warm / cool drift + lightness wobble (zero-mean noise)
  warm: { cheek: 0.03, tip: 0.035, ear: 0.03, g: -0.22, b: -0.38 }, // redder cheeks, nose tip, ear rims
  under: [0.03, 0.017, 0.008], // thin skin under the eyes: cooler and a touch darker
  temple: [0.02, 0.009, -0.009], // temples: faint cool tint
  wing: [0.025, -0.008, -0.012], // nostril wings: faint redness
  freckle: [0.1, 0.17, 0.26], // freckles: soft warm-brown darkening
};
const glslVec3 = (v) => `vec3( ${v.map((x) => x.toFixed(4)).join(", ")} )`;

// Integer (PCG3D) hash: exact on the GPU and in JS (Math.imul), so the CPU estimator sees the very same noise as the shader.
const PHOTO_GLSL_FUNCS = `
float skinHash( vec3 cell ) {
  uvec3 v = uvec3( ivec3( cell ) ) * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return float( v.x ) / 4294967295.0;
}
float skinNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( skinHash( i ), skinHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( skinHash( i + vec3( 0, 1, 0 ) ), skinHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( skinHash( i + vec3( 0, 0, 1 ) ), skinHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( skinHash( i + vec3( 0, 1, 1 ) ), skinHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;

// The photographic layer. Everything is a small multiplicative change to the albedo, masked to the front facial skin, in
// head-relative units (q = inter-pupil distances from the eye midpoint: +x to the side, +y up, +z forward). Pure ALU: noise from
// the object-space position, so no extra texture reads and no UV-seam artefacts. The layer's mean over the face is measured at
// load (see measureBalance) and subtracted at the end (uSkinBalance), so the complexion is unchanged by construction.
const PHOTO_GLSL_BODY = `
#ifdef SKIN_PHOTO
  {
    vec3 q = ( vSkinPos - uSkinEye ) / uSkinIpd;
    float aq = abs( q.x );
    // cheek and nostril zones (morph-derived), kept local by positional windows: the cheek shapes also lift the brow area and
    // the nostril shapes tug the glabella, which must not count as cheek or nose
    float cheekZ = smoothstep( 0.12, 0.5, vSkinZones.x ) * smoothstep( -1.3, -1.0, q.y ) * ( 1.0 - smoothstep( -0.2, 0.1, q.y ) );
    float noseZ = smoothstep( 0.2, 0.6, vSkinZones.y ) * smoothstep( -1.1, -0.85, q.y ) * ( 1.0 - smoothstep( -0.45, -0.2, q.y ) );
    // front-facing skin only (object-space normal), inside a face envelope: cheekbones at the sides, hairline above, chin below
    float front = smoothstep( 0.15, 0.55, vSkinN.z );
    float envFace = ( 1.0 - smoothstep( 0.85, 1.10, aq ) ) * ( 1.0 - smoothstep( 0.65, 0.95, q.y ) ) * smoothstep( -1.85, -1.55, q.y ) * front;
    // exclusions: lips, eyelids and brows (morph-derived, kept local by a positional window)
    float lipsWin = smoothstep( -1.45, -1.25, q.y ) * ( 1.0 - smoothstep( -0.80, -0.55, q.y ) );
    float lidWin = smoothstep( -0.45, -0.25, q.y ) * ( 1.0 - smoothstep( 0.42, 0.62, q.y ) );
    float excl = max( smoothstep( 0.45, 0.80, vSkinZones.z ) * lipsWin, smoothstep( 0.45, 0.80, vSkinZones.w ) * lidWin );
    float live = envFace * ( 1.0 - excl );
    vec3 before = diffuseColor.rgb;
    vec3 c = before;

    // 1. colour variation
    float nBroad = skinNoise( q * 1.7 + uSkinSeed ) * 2.0 - 1.0;
    float nMid = skinNoise( q * 4.6 + uSkinSeed * 1.9 + 11.0 ) * 2.0 - 1.0;
    float nLight = skinNoise( q * 3.1 + uSkinSeed * 0.7 + 29.0 ) * 2.0 - 1.0;
    float v = 0.6 * nBroad + 0.4 * nMid;
    vec3 variation = ( vec3( 1.0 ) + v * ${glslVec3(FX.variation.rgb)} ) * ( 1.0 + ${FX.variation.light.toFixed(4)} * nLight );
    c *= mix( vec3( 1.0 ), variation, live * uSkinFx.x );

    // 2. warmth: cheeks, nose tip, ear rims
    float tip = exp( -dot( q - uSkinNose, q - uSkinNose ) / ( 2.0 * 0.20 * 0.20 ) );
    float ear = smoothstep( 0.95, 1.15, aq ) * ( 1.0 - smoothstep( -0.7, -0.2, q.z ) ) * smoothstep( -1.7, -1.2, q.y ) * ( 1.0 - smoothstep( 0.35, 0.6, q.y ) );
    float warm = cheekZ * live * ${FX.warm.cheek.toFixed(4)} + tip * live * ${FX.warm.tip.toFixed(4)} + ear * ${FX.warm.ear.toFixed(4)};
    c *= 1.0 + uSkinFx.w * vec3( warm, ${FX.warm.g.toFixed(4)} * warm, ${FX.warm.b.toFixed(4)} * warm );

    // 3. capillaries: a faint cool tint at the temples and the thin skin under the eyes; faint redness at the nostril wings
    float fine = 0.65 + 0.35 * nMid;
    float under = exp( -( pow( ( aq - 0.45 ) / 0.30, 2.0 ) + pow( ( q.y + 0.28 ) / 0.14, 2.0 ) ) ) * live;
    float temple = exp( -( pow( ( aq - 1.0 ) / 0.20, 2.0 ) + pow( ( q.y - 0.12 ) / 0.25, 2.0 ) ) ) * ( 1.0 - excl ) * front;
    c *= 1.0 - uSkinFx.z * ( under * ${glslVec3(FX.under)} * fine + temple * ${glslVec3(FX.temple)} * fine );
    c *= 1.0 + uSkinFx.z * noseZ * live * ${glslVec3(FX.wing)};

    // 4. freckles: sparse, small, soft-edged, clustered; nose bridge and cheeks, fading toward the eyes, the mouth and the hairline
    float envY = ( 1.0 - smoothstep( -0.10, 0.15, q.y ) ) * smoothstep( -1.25, -0.8, q.y );
    float bridge = 1.0 - smoothstep( 0.18, 0.42, aq );
    float eyeDist = min( length( q.xy - vec2( 0.5, 0.0 ) ), length( q.xy - vec2( -0.5, 0.0 ) ) );
    float env = live * envY * max( cheekZ, bridge ) * smoothstep( 0.30, 0.65, eyeDist );
    float spot = smoothstep( 0.80, 0.90, skinNoise( q * 15.0 + uSkinSeed * 3.1 ) );
    float tiny = smoothstep( 0.86, 0.94, skinNoise( q * 27.0 + uSkinSeed * 5.3 ) );
    float cluster = smoothstep( 0.35, 0.75, skinNoise( q * 2.6 + uSkinSeed * 0.6 + 5.0 ) );
    float freckle = clamp( spot + 0.6 * tiny, 0.0, 1.0 ) * cluster * env * uSkinFx.y;
    c *= 1.0 - freckle * ${glslVec3(FX.freckle)};

    // the probe pass (SKIN_DEBUG 3) reads the layer's factor back to measure its mean (see measureBalance)
    skinProbeOut = vec4( ( c / max( before, vec3( 0.0001 ) ) - 1.0 ) * 2.5 + 0.5, live );

    // 5. centre the layer: subtract its measured mean over the live face so the complexion is unchanged
    c *= 1.0 - live * uSkinBalance;

    diffuseColor.rgb = c;
#if SKIN_DEBUG == 1
    diffuseColor.rgb = vec3( live, excl, max( cheekZ, noseZ ) );
#elif SKIN_DEBUG == 2
    diffuseColor.rgb = vec3( 0.5 ) + ( c - before ) * 10.0;
#endif
  }
#endif
`;

// --- Centring the layer --------------------------------------------------------------------------------------------
// The layer must not change the complexion. Rather than mirroring the shader on the CPU, measure it exactly as the camera sees
// it: render the head once, from the front, into a tiny offscreen target with a probe variant of the same shader (SKIN_DEBUG 3
// writes the layer's factor and the `live` mask instead of a lit colour), read it back and average. B = sum(live * (F - 1)) /
// sum(live^2); the shader then subtracts live * B, so the mean change over the face is zero.

const PROBE_SIZE = 256;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Object3D} avatarRoot
 * @param {THREE.Mesh} mesh        the head mesh
 * @param {THREE.Material} probeMaterial
 * @returns {THREE.Vector3}
 */
function measureBalance(renderer, avatarRoot, mesh, probeMaterial) {
  const target = new THREE.WebGLRenderTarget(PROBE_SIZE, PROBE_SIZE, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true });
  const scene = new THREE.Scene();
  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const half = Math.max(size.x, size.y) * 0.55;
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, 10);
  camera.position.set(center.x, center.y, center.z + 2);
  camera.lookAt(center);
  camera.layers.set(3); // only the head mesh is on layer 3, so hair, glasses and the body can't hide skin from the probe
  camera.updateMatrixWorld(true);

  const prev = { material: mesh.material, layers: mesh.layers.mask, culled: mesh.frustumCulled, parent: avatarRoot.parent };
  const savedTarget = renderer.getRenderTarget();
  const savedClear = renderer.getClearColor(new THREE.Color());
  const savedAlpha = renderer.getClearAlpha();
  const savedAuto = renderer.autoClear;
  const savedTone = renderer.toneMapping;
  const out = new Uint8Array(PROBE_SIZE * PROBE_SIZE * 4);
  try {
    mesh.material = probeMaterial;
    mesh.layers.enable(3);
    mesh.frustumCulled = false;
    scene.add(avatarRoot); // temporarily; it is detached again below (enhanceSkin runs before the avatar joins its scene)
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, PROBE_SIZE, PROBE_SIZE, out);
  } finally {
    scene.remove(avatarRoot);
    if (prev.parent) prev.parent.add(avatarRoot);
    mesh.material = prev.material;
    mesh.layers.mask = prev.layers;
    mesh.frustumCulled = prev.culled;
    renderer.setRenderTarget(savedTarget);
    renderer.setClearColor(savedClear, savedAlpha);
    renderer.autoClear = savedAuto;
    renderer.toneMapping = savedTone;
    target.dispose();
  }
  const num = [0, 0, 0];
  let den = 0;
  for (let i = 0; i < out.length; i += 4) {
    const live = out[i + 3] / 255;
    if (live <= 0) continue;
    for (let c = 0; c < 3; c++) num[c] += live * ((out[i + c] / 255 - 0.5) / 2.5);
    den += live * live;
  }
  return den > 0 ? new THREE.Vector3(num[0] / den, num[1] / den, num[2] / den) : new THREE.Vector3();
}

/**
 * Shared by every skin material so the program compiles once per variant. Runs with `this` = the material,
 * and reads that material's own settings from userData.skinDetail.
 * @this {THREE.Material}
 * @param {{ uniforms: Record<string, { value: unknown }>, vertexShader: string, fragmentShader: string }} shader
 */
function patchSkinShader(shader) {
  const cfg = /** @type {any} */ (this.userData).skinDetail;
  shader.uniforms.uSkinDetail = { value: cfg.texture };
  shader.uniforms.uSkinRepeat = { value: cfg.repeat };
  shader.uniforms.uSkinStrength = { value: cfg.strength };
  shader.uniforms.uSkinRoughness = { value: cfg.roughness };

  const photo = cfg.photo;
  let defines = "";
  let fragHead = "uniform sampler2D uSkinDetail;\nuniform float uSkinRepeat;\nuniform float uSkinStrength;\nuniform float uSkinRoughness;\n";
  if (photo) {
    defines = `#define SKIN_PHOTO\n#define SKIN_DEBUG ${photo.debug | 0}\n`;
    shader.uniforms.uSkinEye = { value: photo.eye };
    shader.uniforms.uSkinIpd = { value: photo.ipd };
    shader.uniforms.uSkinNose = { value: photo.nose };
    shader.uniforms.uSkinSeed = { value: photo.seed };
    shader.uniforms.uSkinFx = { value: photo.fx };
    shader.uniforms.uSkinBalance = { value: photo.balance };
    shader.vertexShader =
      defines + "attribute vec4 aSkinZones;\nvarying vec3 vSkinPos;\nvarying vec3 vSkinN;\nvarying vec4 vSkinZones;\n" +
      shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkinPos = position;\nvSkinN = normal;\nvSkinZones = aSkinZones;");
    fragHead += "vec4 skinProbeOut;\nuniform vec3 uSkinEye;\nuniform float uSkinIpd;\nuniform vec3 uSkinNose;\nuniform vec3 uSkinSeed;\nuniform vec4 uSkinFx;\nuniform vec3 uSkinBalance;\nvarying vec3 vSkinPos;\nvarying vec3 vSkinN;\nvarying vec4 vSkinZones;\n" + PHOTO_GLSL_FUNCS;
  }

  shader.fragmentShader =
    defines + fragHead +
    shader.fragmentShader
      // After the colour map: the detail map is sampled once here (roughness and normal reuse it) and the photographic layer
      // adjusts the albedo.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec4 skinDetailTexel = texture2D( uSkinDetail, vNormalMapUv * uSkinRepeat );
#endif
${photo ? PHOTO_GLSL_BODY : ""}`,
      )
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
#if defined( SKIN_PHOTO ) && SKIN_DEBUG == 3
  gl_FragColor = skinProbeOut;
#endif`)
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
#ifdef USE_NORMALMAP_TANGENTSPACE
  roughnessFactor = clamp( roughnessFactor + ( skinDetailTexel.a - 0.5 ) * 2.0 * uSkinRoughness, 0.04, 1.0 );
#endif`,
      )
      // Blend the detail normal with the model's own normal map (whiteout blend), in tangent space.
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
#ifdef USE_NORMALMAP_TANGENTSPACE
  {
    vec3 detailN = skinDetailTexel.xyz * 2.0 - 1.0;
    detailN.xy *= uSkinStrength;
    vec3 blendedN = normalize( vec3( mapN.xy + detailN.xy, mapN.z * detailN.z ) );
    normal = normalize( tbn * blendedN );
  }
#endif`,
      );
}

// ---------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------

function isSkinMaterial(material) {
  if (!material || !material.name) return false;
  return SKIN_MATERIAL_NAMES.has(material.name) || /skin/i.test(material.name);
}

/**
 * Whether the skin quality layers (detail normal + photographic layer) should run on this device. Off on low-power
 * devices (few cores AND a touch / small screen). The Vite env flag VITE_SKIN_DETAIL=off also disables it.
 * @returns {boolean}
 */
export function shouldEnableSkinDetail() {
  if (typeof navigator === "undefined" || typeof window === "undefined") return true;
  const lowCores = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const small = typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
  return !(lowCores && (coarse || small));
}

/**
 * Adds fine skin detail to the skin materials (AvatarHead / AvatarBody) of an avatar: a detail normal, a little roughness
 * variation and a faint sheen everywhere, plus (on the face) a procedural photographic layer of subtle colour variation,
 * warmth, freckles and capillary tint. The base colour map is never replaced and the layers are zero-mean / masked, so
 * the complexion holds.
 * @param {THREE.Object3D} avatarRoot
 * @param {SkinDetailOptions} [options]
 * @returns {{ enabled: boolean, meshes: string[], photographic: string[] }}
 */
export function enhanceSkin(avatarRoot, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  /** @type {string[]} */
  const meshes = [];
  /** @type {string[]} */
  const photographic = [];
  if (!opts.enabled) return { enabled: false, meshes, photographic };

  const texture = getSkinDetailTexture();
  /** @type {Map<THREE.Material, THREE.Material>} */
  const replaced = new Map(); // one new material per original, even if several meshes share it

  avatarRoot.traverse((obj) => {
    const mesh = /** @type {THREE.Mesh} */ (obj);
    if (!mesh.isMesh) return;
    const isArray = Array.isArray(mesh.material);
    const list = isArray ? mesh.material : [mesh.material];
    const next = list.map((original) => {
      if (!isSkinMaterial(original) || !original.normalMap) return original; // detail needs the UVs + tangent frame
      let enhanced = replaced.get(original);
      if (!enhanced) {
        enhanced = upgradeMaterial(original, mesh, avatarRoot, texture, opts);
        replaced.set(original, enhanced);
        if (enhanced.userData.skinDetail.photo) photographic.push(`${mesh.name || "(unnamed)"}:${original.name}`);
      }
      meshes.push(`${mesh.name || "(unnamed)"}:${original.name}`);
      return enhanced;
    });
    mesh.material = isArray ? next : next[0];
  });

  for (const original of replaced.keys()) original.dispose(); // shaders only; the shared textures live on
  return { enabled: true, meshes, photographic };
}

/** Tiny deterministic seed -> offset so each avatar's noise is different. */
function seedVector(seed) {
  const h = (k) => ((Math.sin(seed * k) * 43758.5453) % 1 + 1) % 1;
  return new THREE.Vector3(h(12.9898) * 40, h(78.233) * 40, h(37.719) * 40);
}

/**
 * @param {THREE.Material} original
 * @param {THREE.Mesh} mesh
 * @param {THREE.Object3D} avatarRoot
 * @param {THREE.DataTexture} texture
 * @param {Required<SkinDetailOptions>} opts
 */
function upgradeMaterial(original, mesh, avatarRoot, texture, opts) {
  const isBody = /body/i.test(original.name);
  const physical = new THREE.MeshPhysicalMaterial();
  // Copies colour, map, normalMap, roughness/metalness maps, side, name, userData, etc. (Standard-level fields.)
  THREE.MeshStandardMaterial.prototype.copy.call(physical, /** @type {THREE.MeshStandardMaterial} */ (original));

  if (opts.sheen > 0) {
    physical.sheen = opts.sheen;
    physical.sheenRoughness = opts.sheenRoughness;
    physical.sheenColor = new THREE.Color(opts.sheenColor);
  }

  // Photographic layer: the face only (a head mesh with facial blendshapes and eye bones to anchor the zones).
  let photo = null;
  if (opts.photographic && !isBody && ensureSkinZones(mesh)) {
    const frame = headFrame(avatarRoot, mesh);
    if (frame) {
      photo = {
        eye: frame.eye,
        ipd: frame.ipd,
        nose: frame.nose,
        seed: seedVector(opts.seed),
        fx: new THREE.Vector4(opts.colourVariation, opts.freckles, opts.capillaries, opts.cheekRedness),
        balance: new THREE.Vector3(),
        debug: opts.debug,
      };
    }
  }

  physical.userData = {
    ...physical.userData,
    skinDetail: {
      texture,
      repeat: opts.detailRepeat,
      strength: isBody ? opts.bodyStrength : opts.detailStrength,
      roughness: isBody ? opts.roughnessVariation * 0.6 : opts.roughnessVariation,
      photo,
    },
  };
  physical.onBeforeCompile = patchSkinShader;
  physical.customProgramCacheKey = () => `${PROGRAM_KEY}:${opts.sheen > 0 ? "sheen" : "plain"}:${photo ? `photo${photo.debug | 0}` : "nophoto"}`;
  physical.needsUpdate = true;

  // Centre the layer: a probe copy of this material (SKIN_DEBUG 3, balance 0) is rendered once, so the layer's mean change over
  // the face can be measured exactly as the camera sees it.
  if (photo && opts.renderer) {
    const probe = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(probe, /** @type {THREE.MeshStandardMaterial} */ (original));
    probe.userData = { skinDetail: { ...physical.userData.skinDetail, photo: { ...photo, balance: new THREE.Vector3(), debug: 3 } } };
    probe.onBeforeCompile = patchSkinShader;
    probe.customProgramCacheKey = () => `${PROGRAM_KEY}:probe`;
    probe.needsUpdate = true;
    photo.balance.copy(measureBalance(opts.renderer, avatarRoot, mesh, probe));
    probe.dispose();
  }
  return physical;
}
