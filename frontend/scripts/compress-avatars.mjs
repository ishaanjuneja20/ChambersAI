// Compresses the HD avatar GLBs: <Name>.hd.glb -> <Name>.opt.glb (same folder). The inputs are never modified.
//
//   textures  KTX2 / Basis Universal with mipmaps (KHR_texture_basisu).
//               UASTC (high quality): every texture used by the skin materials (AvatarHead / AvatarBody), every normal map and the
//               hair colour map (ETC1S smooths the strands next to the face).
//               ETC1S (small): everything else (hair mr / occlusion, clothing, eyes, teeth, glasses, earrings).
//               baseColor / emissive are tagged sRGB, the rest linear. Skin textures are capped at 2048 px, others at 1024 px.
//   geometry  EXT_meshopt_compression (lossless entropy coding). Attributes stay float32 in the source's units and the skin / node
//               transforms are untouched: skinDetail.js builds its face mask from the raw position and morph-delta attributes (in
//               metres), so KHR_mesh_quantization (normalised int16 + a compensating transform) would break it. Instead the low
//               mantissa bits are zeroed (16-bit mantissa for positions, 12 for morph deltas, ...), which meshopt then codes in
//               a fraction of the bytes. Vertices are reordered for size; nodes, bones, meshes, primitives and morph targets are
//               never merged, renamed, removed or flattened.
//   fallback  if `toktx` (KTX-Software) can't be found, or AVATAR_TEXTURES=webp, textures become WebP (EXT_texture_webp, cwebp).
//
// Usage: npm run build:avatars:compress          (then it runs scripts/verify-avatar-glbs.mjs on every output)
// Env:   KTX_BIN=/path/to/toktx   AVATAR_TEXTURES=ktx2|webp   ONLY=constitutional,labour (lawyer ids)
//        UASTC_RDO_SKIN / UASTC_RDO_OTHER=<lambda, 0 = off>  UASTC_QUALITY=0..4   ETC1S_CLEVEL=0..5  ETC1S_QLEVEL=1..255
// Also (re)writes src/components/avatar3d/avatarVersions.json (see scripts/avatar-versions.mjs).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP, KHRTextureBasisu } from "@gltf-transform/extensions";
import { reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { writeAvatarVersions } from "./avatar-versions.mjs";

const run = promisify(execFile);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const num = (name, fallback) => (process.env[name] !== undefined ? Number(process.env[name]) : fallback);

// ---- settings -------------------------------------------------------------------------------------------------------
export const SETTINGS = {
  skinTextureMax: 2048, // px cap for AvatarHead / AvatarBody textures
  otherTextureMax: 1024, // px cap for everything else
  uastcQuality: num("UASTC_QUALITY", 3), // 0 fastest .. 4 best
  uastcRdoSkin: num("UASTC_RDO_SKIN", 0.5), // RDO lambda for skin textures: 0 = off (near-lossless UASTC + zstd only); 0.5 is ~48 dB PSNR
  uastcRdoOther: num("UASTC_RDO_OTHER", 1), // RDO lambda for the non-skin normal maps (outfit, hair, teeth, eyes)
  zstdLevel: 19,
  etc1sClevel: num("ETC1S_CLEVEL", 3), // 0..5 compression effort
  etc1sQlevel: num("ETC1S_QLEVEL", 192), // 1..255 quality
  webpQualitySkin: 92,
  webpQualityOther: 85,
  // Mantissa bits kept per float32 attribute (23 = lossless). Relative precision is 2^-bits: 16 bits on a 1.6 m-high head vertex is ~12 um.
  mantissaBits: { position: 16, positionDelta: 12, normal: 12, normalDelta: 10, texcoord: 16, weight: 14, other: 14 },
};
const SKIN_MATERIAL = /^Avatar(Head|Body)$/;
const HAIR_MATERIAL = /^hair/i; // sits right next to the face: ETC1S visibly smooths the strands, so its colour map is UASTC too
const SRGB_SLOTS = new Set(["baseColor", "emissive"]);

// ---- toktx ----------------------------------------------------------------------------------------------------------
function findToktx() {
  const candidates = [process.env.KTX_BIN, ...(process.env.PATH ?? "").split(":").map((d) => join(d, "toktx")), join(homedir(), ".local/ktx-software-4.4.2/bin/toktx"), "/usr/local/bin/toktx"];
  return candidates.find((p) => p && existsSync(p));
}

// ---- model discovery (same parsing as the headshot script) -----------------------------------------------------------
async function listModels() {
  const src = await readFile(join(root, "src/components/avatar3d/lawyerModels.ts"), "utf8");
  const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
  return [...src.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)]
    .map(([, id, tpl]) => ({ id, original: tpl.match(/brand\/[^"`]+?\.glb/)?.[0] }))
    .filter((m) => m.original && (!only || only.includes(m.id)))
    .map((m) => ({ ...m, hd: m.original.replace(/\.glb$/, ".hd.glb"), opt: m.original.replace(/\.glb$/, ".opt.glb") }));
}

function textureUses(doc) {
  const uses = new Map(); // texture -> [{ material, slot }]
  for (const m of doc.getRoot().listMaterials()) {
    const slots = { baseColor: m.getBaseColorTexture(), normal: m.getNormalTexture(), metalRough: m.getMetallicRoughnessTexture(), emissive: m.getEmissiveTexture(), occlusion: m.getOcclusionTexture() };
    for (const [slot, tex] of Object.entries(slots)) if (tex) (uses.get(tex) ?? uses.set(tex, []).get(tex)).push({ material: m.getName(), slot });
  }
  return uses;
}

const extOf = (mime) => ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[mime];

// ---- one texture ----------------------------------------------------------------------------------------------------
async function encodeKtx2(toktx, tmp, tex, plan) {
  const [w, h] = tex.getSize();
  const input = join(tmp, `in.${extOf(tex.getMimeType())}`);
  const output = join(tmp, "out.ktx2");
  await writeFile(input, tex.getImage());
  const s = SETTINGS;
  const args = ["--t2", "--genmipmap", "--assign_oetf", plan.srgb ? "srgb" : "linear", "--assign_primaries", "bt709"];
  if (Math.max(w, h) > plan.cap) {
    const k = plan.cap / Math.max(w, h);
    args.push("--resize", `${Math.max(4, Math.round((w * k) / 4) * 4)}x${Math.max(4, Math.round((h * k) / 4) * 4)}`);
  }
  if (plan.uastc) {
    args.push("--encode", "uastc", "--uastc_quality", String(s.uastcQuality), "--zcmp", String(s.zstdLevel));
    const rdo = plan.skin ? s.uastcRdoSkin : s.uastcRdoOther;
    if (rdo > 0) args.push("--uastc_rdo_l", String(rdo));
  } else {
    args.push("--encode", "etc1s", "--clevel", String(s.etc1sClevel), "--qlevel", String(s.etc1sQlevel));
  }
  await run(toktx, [...args, output, input], { maxBuffer: 1 << 26 });
  return readFile(output);
}

async function encodeWebp(tmp, tex, plan) {
  const input = join(tmp, `in.${extOf(tex.getMimeType())}`);
  const output = join(tmp, "out.webp");
  await writeFile(input, tex.getImage());
  const q = plan.skin || plan.normal ? SETTINGS.webpQualitySkin : SETTINGS.webpQualityOther;
  await run("cwebp", ["-q", String(q), "-alpha_q", "100", "-m", "6", "-sharp_yuv", input, "-o", output]);
  return readFile(output);
}

// ---- geometry precision ----------------------------------------------------------------------------------------------
function roundMantissa(accessor, bits) {
  const array = accessor.getArray();
  if (!(array instanceof Float32Array) || bits >= 23) return;
  const out = new Float32Array(array); // copy, then work on the raw bits
  const u = new Uint32Array(out.buffer);
  const drop = 23 - bits;
  const half = 1 << (drop - 1);
  const mask = ~((1 << drop) - 1) >>> 0;
  for (let i = 0; i < u.length; i++) {
    const exponent = (u[i] >>> 23) & 0xff;
    if (exponent === 0xff) continue; // NaN / Inf
    u[i] = ((u[i] + half) & mask) >>> 0; // round to nearest; a mantissa carry correctly bumps the exponent
  }
  accessor.setArray(out);
}

function roundGeometry(doc) {
  const bits = SETTINGS.mantissaBits;
  const pick = (semantic, delta) => {
    if (semantic === "POSITION") return delta ? bits.positionDelta : bits.position;
    if (semantic === "NORMAL" || semantic === "TANGENT") return delta ? bits.normalDelta : bits.normal;
    if (semantic.startsWith("TEXCOORD")) return bits.texcoord;
    if (semantic.startsWith("WEIGHTS")) return bits.weight;
    return bits.other;
  };
  const done = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const [holder, delta] of [[prim, false], ...prim.listTargets().map((t) => [t, true])]) {
        for (const semantic of holder.listSemantics()) {
          const accessor = holder.getAttribute(semantic);
          if (done.has(accessor)) continue; // an accessor shared by several primitives is rounded once
          done.add(accessor);
          roundMantissa(accessor, pick(semantic, delta));
        }
      }
    }
  }
}

// ---- one file -------------------------------------------------------------------------------------------------------
async function compress(model, { toktx, webp }) {
  const inPath = join(root, "public", model.hd);
  const outPath = join(root, "public", model.opt);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });
  const doc = await io.read(inPath);
  const tmp = await mkdtemp(join(tmpdir(), "avatar-tex-"));
  const rows = [];
  try {
    const uses = textureUses(doc);
    for (const tex of doc.getRoot().listTextures()) {
      const u = uses.get(tex) ?? [];
      const skin = u.some((x) => SKIN_MATERIAL.test(x.material));
      const normal = u.some((x) => x.slot === "normal");
      const srgb = u.length > 0 && u.every((x) => SRGB_SLOTS.has(x.slot));
      if (u.some((x) => SRGB_SLOTS.has(x.slot)) && !srgb) throw new Error(`texture shared between sRGB and linear slots: ${JSON.stringify(u)}`);
      const hair = u.some((x) => HAIR_MATERIAL.test(x.material) && x.slot === "baseColor");
      const plan = { skin, normal, srgb, uastc: skin || normal || hair, cap: skin ? SETTINGS.skinTextureMax : SETTINGS.otherTextureMax };
      const before = tex.getImage().byteLength;
      const [w, h] = tex.getSize();
      const bytes = webp ? await encodeWebp(tmp, tex, plan) : await encodeKtx2(toktx, tmp, tex, plan);
      tex.setImage(new Uint8Array(bytes)).setMimeType(webp ? "image/webp" : "image/ktx2");
      rows.push({ uses: u.map((x) => `${x.material}:${x.slot}`).join(","), size: `${w}x${h}`, codec: webp ? "webp" : plan.uastc ? "UASTC" : "ETC1S", colour: plan.srgb ? "sRGB" : "linear", beforeKB: Math.round(before / 1024), afterKB: Math.round(bytes.length / 1024) });
    }
    doc.createExtension(webp ? EXTTextureWebP : KHRTextureBasisu).setRequired(true);

    await MeshoptEncoder.ready;
    // cleanup:false: the built-in cleanup runs prune, which isn't allowed here.
    if (!process.env.NO_REORDER) await doc.transform(reorder({ encoder: MeshoptEncoder, target: "size", cleanup: false }));
    roundGeometry(doc);
    // Drop only the accessors reorder orphaned. Nodes, skins, meshes, materials and textures are left alone.
    for (const accessor of doc.getRoot().listAccessors()) {
      if (accessor.listParents().every((parent) => parent.propertyType === "Root")) accessor.dispose();
    }
    // Lossless meshopt coding of the (rounded) attributes. The FILTER method would re-encode normals as 8-bit octahedral.
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    await io.write(outPath, doc);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return rows;
}

// ---- main -----------------------------------------------------------------------------------------------------------
const toktx = process.env.AVATAR_TEXTURES === "webp" ? undefined : findToktx();
const webp = !toktx;
if (webp) console.warn(process.env.AVATAR_TEXTURES === "webp" ? "AVATAR_TEXTURES=webp: writing WebP textures." : "toktx not found (set KTX_BIN or install KTX-Software): FALLING BACK TO WEBP textures.");
else console.log(`toktx: ${toktx}`);

const models = await listModels();
const summary = [];
for (const model of models) {
  if (!existsSync(join(root, "public", model.hd))) {
    console.warn(`skip ${model.id}: ${model.hd} not found`);
    continue;
  }
  const t0 = Date.now();
  const rows = await compress(model, { toktx, webp });
  const sizes = { hd: (await stat(join(root, "public", model.hd))).size, opt: (await stat(join(root, "public", model.opt))).size };
  console.log(`\n[${model.id}] ${model.hd} -> ${model.opt}  ${(sizes.hd / 1048576).toFixed(2)} MB -> ${(sizes.opt / 1048576).toFixed(2)} MB  (${(sizes.hd / sizes.opt).toFixed(2)}x, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.table(rows);
  summary.push({ id: model.id, hdMB: +(sizes.hd / 1048576).toFixed(2), optMB: +(sizes.opt / 1048576).toFixed(2), ratio: +(sizes.hd / sizes.opt).toFixed(2) });
}
console.log("\nsummary");
console.table(summary);
console.log(`total: ${summary.reduce((a, s) => a + s.hdMB, 0).toFixed(1)} MB -> ${summary.reduce((a, s) => a + s.optMB, 0).toFixed(1)} MB`);
console.log(`versions: ${await writeAvatarVersions()}`);
