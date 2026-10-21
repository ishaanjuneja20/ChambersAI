// One-off: render a passport-style headshot of each lawyer's GLB avatar into public/lawyers/<id>.jpg.
// Usage: npm run render:headshots   (set CHROME_PATH to override the browser; no browser is downloaded)
// Tuning helpers: SKIN_OPTS='{"detailRepeat":20,"detailStrength":0.35}' overrides the skin-detail options (see
// src/components/avatar3d/skinDetail.js), SKIN_OPTS='{"enabled":false}' renders without it, HEADSHOT_OUT=<dir>
// writes somewhere other than public/lawyers, and HEADSHOT_ONLY=criminal,family renders just those ids.
// Compression checks (the committed headshots are always rendered from the uncompressed .hd.glb): HEADSHOT_COMPRESSED=1 renders from
// the .opt.glb files (KTX2 + meshopt) and measures the skin against their .hd.glb twins; HEADSHOT_GPU=1 uses the machine's real
// GPU instead of SwiftShader.
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { DEFAULT_SKIN_PROFILE, SKIN_PROFILES } from "../src/components/avatar3d/skinProfiles.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outDir = process.env.HEADSHOT_OUT ? resolve(process.env.HEADSHOT_OUT) : join(root, "public", "lawyers");
const skinOptions = process.env.SKIN_OPTS ? JSON.parse(process.env.SKIN_OPTS) : {};
const compressed = !!process.env.HEADSHOT_COMPRESSED;
const only = process.env.HEADSHOT_ONLY ? process.env.HEADSHOT_ONLY.split(",") : null;

// lawyer id -> GLB path, read from lawyerModels.ts so it stays the single source of truth.
const modelsSrc = await readFile(join(root, "src/components/avatar3d/lawyerModels.ts"), "utf8");
// lawyerModels.ts has a one-line switch (USE_HD_AVATARS) for the .hd.glb files; follow it so the headshots match the live avatar.
const useHd = /USE_HD_AVATARS\s*=\s*true/.test(modelsSrc) && !process.env.HEADSHOT_ORIGINAL; // HEADSHOT_ORIGINAL=1 forces the original GLBs
const models = [...modelsSrc.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)].map(([, id, tpl]) => {
  const file = tpl.match(/brand\/[^"`]+?\.glb/)?.[0];
  if (!file) throw new Error(`Can't find a .glb path for "${id}" in lawyerModels.ts`);
  const hdFile = file.replace(/\.glb$/, ".hd.glb");
  const optFile = file.replace(/\.glb$/, ".opt.glb");
  const source = useHd && existsSync(join(root, "public", hdFile)) ? hdFile : file;
  if (!compressed) return { id, file: source };
  if (!existsSync(join(root, "public", optFile))) throw new Error(`HEADSHOT_COMPRESSED=1 but ${optFile} doesn't exist (npm run build:avatars:compress)`);
  return { id, file: optFile, ref: source };
});
if (!models.length) throw new Error("No lawyer models found in lawyerModels.ts");

const chromePath =
  process.env.CHROME_PATH ??
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(existsSync);
if (!chromePath) throw new Error("No system Chrome/Chromium found. Set CHROME_PATH.");

const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".glb": "model/gltf-binary", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const rel = path === "/" ? "scripts/headshots/index.html" : path.replace(/^\//, "");
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) throw new Error("outside root");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: chromePath,
  args: [...(process.env.HEADSHOT_GPU ? ["--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]), "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.headshotsReady === true, null, { timeout: 30000 });

  await mkdir(outDir, { recursive: true });
  for (const { id, file, ref } of models) {
    if (only && !only.includes(id)) continue;
    const { dataUrl, skin, skinSummary } = await page.evaluate(([url, opts, refUrl]) => window.renderHeadshot(url, opts, refUrl), [`${origin}/public/${encodeURI(file)}`, { ...(SKIN_PROFILES[id] ?? DEFAULT_SKIN_PROFILE), ...skinOptions }, ref ? `${origin}/public/${encodeURI(ref)}` : null]);
    await writeFile(join(outDir, `${id}.jpg`), Buffer.from(dataUrl.split(",")[1], "base64"));
    console.log(`${id}.jpg  <-  ${file}  [skin detail: ${skinSummary.enabled ? skinSummary.meshes.join(", ") : "off"}; photographic: ${skinSummary.photographic?.join(", ") || "none"}]`);
    for (const s of skin) console.log(`    skin ${s.mesh}: texture ${s.texture} render ${s.render} linear ratio (r,g,b) ${s.ratio}`);
  }
} finally {
  await browser.close();
  server.close();
}
