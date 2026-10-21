// Writes src/components/avatar3d/avatarVersions.json: a short content hash for every lawyer GLB variant that exists
// (<Name>.glb, <Name>.hd.glb, <Name>.opt.glb). lawyerModels.ts appends it to the model URL as ?v=<hash>, so a rebuilt model
// is re-downloaded even though /brand/assets/lawyers/* is served with an immutable cache header (file names aren't hashed).
// Called by compress-avatars.mjs and build-hd-avatars.mjs; also runnable on its own: node scripts/avatar-versions.mjs
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function writeAvatarVersions() {
  const src = await readFile(join(root, "src/components/avatar3d/lawyerModels.ts"), "utf8");
  const versions = {};
  for (const [, , tpl] of src.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)) {
    const original = tpl.match(/brand\/[^"`]+?\.glb/)?.[0];
    if (!original) continue;
    for (const file of [original, original.replace(/\.glb$/, ".hd.glb"), original.replace(/\.glb$/, ".opt.glb")]) {
      const path = join(root, "public", file);
      if (existsSync(path)) versions[file] = createHash("sha1").update(await readFile(path)).digest("hex").slice(0, 8);
    }
  }
  const out = join(root, "src/components/avatar3d/avatarVersions.json");
  await writeFile(out, JSON.stringify(Object.fromEntries(Object.entries(versions).sort()), null, 2) + "\n");
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(`wrote ${await writeAvatarVersions()}`);
