import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
const f = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"meshopt.decoder": MeshoptDecoder});
for (const p of f) {
  const doc = await io.read(p);
  const root = doc.getRoot();
  console.log("\n##", p.split("/").pop());
  const use = new Map();
  for (const m of root.listMaterials()) {
    const s = {baseColor:m.getBaseColorTexture(), normal:m.getNormalTexture(), mr:m.getMetallicRoughnessTexture(), emissive:m.getEmissiveTexture(), occ:m.getOcclusionTexture()};
    for (const [k,t] of Object.entries(s)) if (t) { (use.get(t) ?? use.set(t,[]).get(t)).push(m.getName()+":"+k); }
  }
  let tot=0, mem=0;
  for (const t of root.listTextures()) {
    const sz = t.getSize(); const b = t.getImage().byteLength; tot+=b; mem += sz[0]*sz[1]*4*4/3;
    console.log(" ", (t.getName()||"?").padEnd(26), sz.join("x").padEnd(10), t.getMimeType().padEnd(11), String(Math.round(b/1024)).padStart(6),"KB", (use.get(t)||[]).join(","));
  }
  console.log("  textures total", (tot/1048576).toFixed(2),"MB; GPU RGBA8+mips est", (mem/1048576).toFixed(1),"MB; meshes", root.listMeshes().length, "nodes", root.listNodes().length, "skins", root.listSkins().length);
  let geo=0; for (const a of root.listAccessors()) geo += a.getArray()?.byteLength ?? 0;
  console.log("  accessor data", (geo/1048576).toFixed(2), "MB");
}
