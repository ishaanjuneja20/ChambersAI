// Runs tests/*.test.mjs with node's built-in test runner. The tests import the TypeScript sources directly, so
// they are bundled first with esbuild (already installed as a dependency of Vite). No browser, no network, no audio.
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outdir = join(root, "node_modules", ".tmp-tests");
rmSync(outdir, { recursive: true, force: true });

const tests = readdirSync(join(root, "tests")).filter((f) => f.endsWith(".test.mjs"));
await build({
  entryPoints: tests.map((f) => join(root, "tests", f)),
  bundle: true,
  format: "esm",
  platform: "node",
  outdir,
  outExtension: { ".js": ".mjs" },
  define: { "import.meta.env.VITE_API_URL": '"http://backend.test"', "import.meta.env.VITE_TTS_API_URL": '"http://backend.test"' },
  logLevel: "error",
});

const run = spawnSync(process.execPath, ["--test", ...tests.map((f) => join(outdir, f))], { stdio: "inherit" });
process.exit(run.status ?? 1);
