// Copies the Basis Universal transcoder (used by three's KTX2Loader to decode the .opt.glb textures) from node_modules into
// public/basis/, where the app fetches it from (`${BASE_URL}basis/`). Runs automatically before `dev` and `build`.
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const from = join(root, "node_modules/three/examples/jsm/libs/basis");
const to = join(root, "public/basis");
await mkdir(to, { recursive: true });
for (const file of ["basis_transcoder.js", "basis_transcoder.wasm"]) await copyFile(join(from, file), join(to, file));
console.log("public/basis/: basis_transcoder.js, basis_transcoder.wasm");
