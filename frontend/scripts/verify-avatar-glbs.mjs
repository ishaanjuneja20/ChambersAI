// Checks that every <Name>.opt.glb has exactly the same structure as its <Name>.hd.glb source: node names and hierarchy,
// bone transforms, skin joints (and inverse bind matrices), mesh list, primitive/vertex counts, morph target names and counts, material names and factors.
// Prints the sizes, the compression ratio and the estimated GPU texture memory. Exits non-zero on any difference.
// Usage: node scripts/verify-avatar-glbs.mjs    (npm run build:avatars:compress runs it after compressing)
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
await MeshoptDecoder.ready;

const src = await readFile(join(root, "src/components/avatar3d/lawyerModels.ts"), "utf8");
const models = [...src.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)].map(([, id, tpl]) => {
  const original = tpl.match(/brand\/[^"`]+?\.glb/)[0];
  return { id, hd: original.replace(/\.glb$/, ".hd.glb"), opt: original.replace(/\.glb$/, ".opt.glb") };
});

const near = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps);

function tree(node) {
  return { name: node.getName(), mesh: node.getMesh()?.getName() ?? null, skin: !!node.getSkin(), children: node.listChildren().map(tree) };
}
function boneTransforms(doc) {
  const out = new Map();
  const joints = new Set(doc.getRoot().listSkins().flatMap((s) => s.listJoints()));
  for (const n of doc.getRoot().listNodes()) if (joints.has(n) || !n.getMesh()) out.set(n.getName(), [...n.getTranslation(), ...n.getRotation(), ...n.getScale()]);
  return out;
}
function meshInfo(doc) {
  return doc.getRoot().listMeshes().map((mesh) => ({
    name: mesh.getName(),
    targetNames: mesh.getExtras()?.targetNames ?? null,
    weights: mesh.getWeights(),
    prims: mesh.listPrimitives().map((p) => ({
      mode: p.getMode(),
      material: p.getMaterial()?.getName() ?? null,
      attributes: p.listSemantics().sort().map((k) => { const a = p.getAttribute(k); return `${k}:${a.getType()}:${a.getComponentType()}:${a.getNormalized()}`; }), // same types / units as the source
      count: p.getAttribute("POSITION")?.getCount(),
      indices: p.getIndices()?.getCount(),
      targets: p.listTargets().map((t) => ({ name: t.getName(), semantics: t.listSemantics().sort().map((k) => { const a = t.getAttribute(k); return `${k}:${a.getType()}:${a.getComponentType()}:${a.getNormalized()}`; }), count: t.getAttribute("POSITION")?.getCount() })),
    })),
  }));
}
function materialInfo(doc) {
  return doc.getRoot().listMaterials().map((m) => ({
    name: m.getName(), alphaMode: m.getAlphaMode(), cutoff: m.getAlphaCutoff(), doubleSided: m.getDoubleSided(),
    base: m.getBaseColorFactor(), rough: m.getRoughnessFactor(), metal: m.getMetallicFactor(), emissive: m.getEmissiveFactor(),
    normalScale: m.getNormalScale(),
    slots: ["BaseColor", "Normal", "MetallicRoughness", "Emissive", "Occlusion"].map((s) => [s, !!m[`get${s}Texture`]()]),
  }));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let failed = 0;
const rows = [];
for (const m of models) {
  const problems = [];
  const a = await io.read(join(root, "public", m.hd));
  const b = await io.read(join(root, "public", m.opt));
  if (!same(a.getRoot().listScenes().map((s) => s.listChildren().map(tree)), b.getRoot().listScenes().map((s) => s.listChildren().map(tree)))) problems.push("node names / hierarchy differ");
  if (!same(a.getRoot().listSkins().map((s) => s.listJoints().map((j) => j.getName())), b.getRoot().listSkins().map((s) => s.listJoints().map((j) => j.getName())))) problems.push("skin joints differ");
  const ta = boneTransforms(a), tb = boneTransforms(b);
  for (const [name, v] of ta) if (!tb.has(name) || !near(v, tb.get(name))) problems.push(`transform of "${name}" differs`);
  const ma = meshInfo(a), mb = meshInfo(b);
  if (!same(ma, mb)) problems.push("mesh / primitive / morph target info differs");
  const ibm = (d) => d.getRoot().listSkins().map((x) => Array.from(x.getInverseBindMatrices().getArray()));
  if (!same(ibm(a), ibm(b))) problems.push("inverse bind matrices differ");
  const meshNodes = (d) => d.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => [n.getName(), ...n.getTranslation(), ...n.getRotation(), ...n.getScale()]);
  if (!same(meshNodes(a), meshNodes(b))) problems.push("mesh node transforms differ");
  if (!same(materialInfo(a), materialInfo(b))) problems.push("materials differ");
  if (a.getRoot().listAnimations().length !== b.getRoot().listAnimations().length) problems.push("animation count differs");
  const targets = ma.flatMap((x) => x.prims.map((p) => p.targets.length));
  const names = ma.map((x) => x.targetNames?.length ?? 0);

  let ramRaw = 0, ramNow = 0;
  const codecs = new Map();
  for (const t of b.getRoot().listTextures()) {
    const [w, h] = t.getSize();
    ramNow += w * h * (t.getMimeType() === "image/ktx2" ? 1 : 4) * (4 / 3);
    codecs.set(t.getMimeType(), (codecs.get(t.getMimeType()) ?? 0) + 1);
  }
  for (const t of a.getRoot().listTextures()) ramRaw += t.getSize()[0] * t.getSize()[1] * 4 * (4 / 3);
  const sa = (await stat(join(root, "public", m.hd))).size, sb = (await stat(join(root, "public", m.opt))).size;
  rows.push({ id: m.id, hdMB: +(sa / 1048576).toFixed(2), optMB: +(sb / 1048576).toFixed(2), ratio: +(sa / sb).toFixed(2), gpuTexBeforeMB: +(ramRaw / 1048576).toFixed(1), gpuTexAfterMB: +(ramNow / 1048576).toFixed(1), nodes: b.getRoot().listNodes().length, meshes: b.getRoot().listMeshes().length, morphTargets: `${Math.max(...targets)} (${Math.max(...names)} names)`, textures: [...codecs].map(([k, v]) => `${v}x${k.replace("image/", "")}`).join(" "), status: problems.length ? "FAIL" : "identical" });
  if (problems.length) {
    failed++;
    console.error(`\n[${m.id}] ${m.opt}`);
    for (const p of problems) console.error(`  - ${p}`);
  }
}
console.table(rows);
const total = (k) => rows.reduce((s, r) => s + r[k], 0).toFixed(1);
console.log(`total ${total("hdMB")} MB -> ${total("optMB")} MB; largest ${Math.max(...rows.map((r) => r.optMB))} MB; GPU texture memory ${total("gpuTexBeforeMB")} MB -> ${total("gpuTexAfterMB")} MB`);
if (failed) {
  console.error(`${failed} file(s) differ from their source`);
  process.exit(1);
}
console.log("structure check: node names, hierarchy, bones, skin joints, meshes, morph targets and materials are identical to the .hd.glb sources");
