// Builds higher-resolution (2048 px) head skin textures for the lawyer GLBs and writes NEW files
// public/brand/assets/lawyers/<Name>.hd.glb. The original GLBs are never modified.
//
// For each lawyer in lawyerModels.ts:
//   1. extract the AvatarHead baseColor texture (1024 px JPEG),
//   2. upscale it with Real-ESRGAN (x4plus, local ncnn-vulkan binary),
//   3. merge it back with colour-safe frequency separation in linear light (scripts/hd/frequency_separate.py):
//      all colour and tone come from the original; the AI only adds fine detail where there is real structure,
//   4. write the 2048 px JPEG into a copy of the GLB with @gltf-transform (only that texture is replaced).
//
// Setup (one-off): download the official release
//   https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip
// unzip it somewhere, `chmod +x realesrgan-ncnn-vulkan`, and point REALESRGAN_DIR at that folder.
// Usage: REALESRGAN_DIR=/path/to/realesrgan node scripts/build-hd-avatars.mjs [id,id,...]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { writeAvatarVersions } from "./avatar-versions.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const work = process.env.HD_WORKDIR ?? join(tmpdir(), "chambersai-hd");
const esrDir = process.env.REALESRGAN_DIR;
if (!esrDir || !existsSync(join(esrDir, "realesrgan-ncnn-vulkan"))) throw new Error("Set REALESRGAN_DIR to the unzipped Real-ESRGAN ncnn-vulkan folder (see the header of this file).");
const only = process.argv[2]?.split(",");
const SIZE = 2048;
const JPEG_QUALITY = Number(process.env.HD_JPEG_QUALITY ?? 90);
const GAIN = process.env.HD_GAIN ?? "0.8"; // how far toward the AI's fine detail (0 = original, 1 = full), applied only where there is real structure
mkdirSync(work, { recursive: true });

const src = await readFile(join(root, "src/components/avatar3d/lawyerModels.ts"), "utf8");
const models = [...src.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)].map(([, id, tpl]) => ({ id, file: tpl.match(/brand\/[^"`]+?\.glb/)[0] }));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const report = [];

for (const { id, file } of models) {
  if (only && !only.includes(id)) continue;
  const glbPath = join(root, "public", file);
  const hdPath = glbPath.replace(/\.glb$/, ".hd.glb");
  const doc = await io.read(glbPath);
  const head = doc.getRoot().listMaterials().find((m) => m.getName() === "AvatarHead");
  const tex = head.getBaseColorTexture();
  const orig = join(work, `${id}.head.base.jpg`);
  const ai = join(work, `${id}.head.base.x4.png`);
  const hd = join(work, `${id}.head.base.hd.png`);
  const hdJpg = join(work, `${id}.head.base.hd.jpg`);
  await writeFile(orig, tex.getImage());

  console.log(`\n[${id}] ${file}: upscaling ${tex.getSize().join("x")} ${tex.getMimeType()}`);
  if (!existsSync(ai)) execFileSync(join(esrDir, "realesrgan-ncnn-vulkan"), ["-i", orig, "-o", ai, "-n", "realesrgan-x4plus", "-s", "4", "-m", join(esrDir, "models"), "-f", "png"], { stdio: "ignore", cwd: work });
  const out = execFileSync("python3", [join(root, "scripts/hd/frequency_separate.py"), orig, ai, hd, "--size", String(SIZE), "--gain", GAIN, "--save-jpeg", hdJpg, "--jpeg-quality", String(JPEG_QUALITY)], { encoding: "utf8", cwd: work });
  process.stdout.write(out);

  const newImage = await readFile(hdJpg);
  tex.setImage(newImage); // same mime type (JPEG); every other texture, mesh and material is untouched
  await io.write(hdPath, doc);
  const [a, b] = [(await stat(glbPath)).size, (await stat(hdPath)).size];
  report.push({ id, original: `${(a / 1048576).toFixed(2)} MB`, hd: `${(b / 1048576).toFixed(2)} MB`, ratio: +(b / a).toFixed(3), headTexture: `${Math.round(tex.getImage().byteLength / 1024)} KB` });
}
console.log("\nfile sizes:");
console.table(report);
console.log(`versions: ${await writeAvatarVersions()}`);
