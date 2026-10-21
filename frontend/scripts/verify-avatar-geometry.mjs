// Loads every <Name>.hd.glb and <Name>.opt.glb in Chrome with three's own loaders and compares the geometry the renderer would draw:
// skinned + morphed vertex positions (rest pose, a posed skeleton, all 51 blendshapes at random / 0.7 / one at a time) and the vertex
// normals. Vertices are matched by rest position + UV + normal, because the compression reorders them. Prints the worst error in
// micrometres / degrees per mesh. Exits non-zero if any error is above the limits below.
// Usage: node scripts/verify-avatar-geometry.mjs     (GPU=1 for the machine's GPU instead of SwiftShader; ONLY=criminal,family to filter)
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const MAX_POSITION_UM = 250; // ~0.25 mm: far below a pixel at the closest framing (0.44 mm per pixel in the headshots)
const MAX_NORMAL_DEG = 0.5;
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const src = await readFile(join(root, "src/components/avatar3d/lawyerModels.ts"), "utf8");
const models = [...src.matchAll(/(\w+):\s*\{\s*modelUrl:\s*`([^`]*)`/g)]
  .map(([, id, tpl]) => ({ id, file: tpl.match(/brand\/[^"`]+?\.glb/)[0] }))
  .filter((m) => !only || only.includes(m.id));

const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = normalize(join(root, path === "/" ? "scripts/headshots/geometry.html" : path));
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
const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync) ?? process.env.CHROME_PATH;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? chrome, args: [...(process.env.GPU ? ["--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]), "--mute-audio"] });
let failed = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("[page]", e.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.ready === true);
  for (const { id, file } of models) {
    const url = (suffix) => `${origin}/public/${encodeURI(file.replace(/\.glb$/, `${suffix}.glb`))}`;
    const rows = await page.evaluate(([a, b]) => window.compare(a, b), [url(".hd"), url(".opt")]);
    const table = rows.map((r) => ({ mesh: r.mesh, verts: r.verts, unmatched: r.unmatched, morphs: r.morphs, states: r.statesTested, "rest err um": r.restMatchMaxUm, "worst err um": r.worstPosErrUm, "worst state": r.worstState, "normal err deg": Math.max(r.normalRestDeg?.max ?? 0, r.normalMorphedDeg?.max ?? 0) }));
    console.log(`\n## ${id}`);
    console.table(table);
    for (const r of table) if (r.unmatched || r["worst err um"] > MAX_POSITION_UM || r["normal err deg"] > MAX_NORMAL_DEG) failed++;
  }
} finally {
  await browser.close();
  server.close();
}
if (failed) {
  console.error(`${failed} mesh(es) above the limits (${MAX_POSITION_UM} um, ${MAX_NORMAL_DEG} deg)`);
  process.exit(1);
}
console.log(`geometry check: every vertex matched; position error <= ${MAX_POSITION_UM} um and normal error <= ${MAX_NORMAL_DEG} deg in all tested poses and blendshape states`);
