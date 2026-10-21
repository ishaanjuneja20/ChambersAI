// Prints the resolution, format and size of the AvatarHead / AvatarBody textures of each lawyer GLB, plus the
// total GLB size. Read-only. Usage: node scripts/audit-avatar-textures.mjs
import { readFile, stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const lawyers = await readFile(new URL("../src/components/avatar3d/lawyerModels.ts", import.meta.url), "utf8");
const models = [...lawyers.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)].map(([, id, tpl]) => ({ id, file: tpl.match(/brand\/[^"`]+?\.glb/)[0] }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const kb = (n) => `${Math.round(n / 1024)} KB`;

for (const { id, file } of models) {
  const path = decodeURIComponent(new URL(`../public/${file}`, import.meta.url).pathname);
  const doc = await io.read(path);
  console.log(`\n${id}  (${file})  total GLB ${(((await stat(path)).size) / 1048576).toFixed(2)} MB`);
  for (const mat of doc.getRoot().listMaterials()) {
    if (!/^Avatar(Head|Body)$/.test(mat.getName())) continue;
    const slots = { baseColor: mat.getBaseColorTexture(), normal: mat.getNormalTexture(), metalRough: mat.getMetallicRoughnessTexture() };
    const row = Object.entries(slots).map(([k, t]) => (t ? `${k} ${t.getSize()?.join("x")} ${t.getMimeType().replace("image/", "")} ${kb(t.getImage().byteLength)}` : `${k} -`));
    console.log(`  ${mat.getName().padEnd(10)} ${row.join(" | ")}`);
  }
}
