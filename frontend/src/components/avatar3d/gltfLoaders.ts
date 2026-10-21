// One GLTFLoader (with KTX2 + meshopt support) shared by every avatar mount, so the Basis transcoder workers and their wasm are
// created once instead of per avatar. Reference counted: the KTX2 worker pool is disposed when the last avatar unmounts.
import type { WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// The transcoder (basis_transcoder.js/.wasm) is copied into public/basis/ by scripts/copy-basis-transcoder.mjs.
const TRANSCODER_PATH = `${import.meta.env.BASE_URL}basis/`;

let shared: { loader: GLTFLoader; ktx2: KTX2Loader; refs: number } | null = null;

export function acquireGLTFLoader(renderer: WebGLRenderer): { loader: GLTFLoader; release: () => void } {
  if (!shared) {
    const ktx2 = new KTX2Loader().setTranscoderPath(TRANSCODER_PATH);
    shared = { loader: new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder), ktx2, refs: 0 };
  }
  const current = shared;
  current.ktx2.detectSupport(renderer); // picks ASTC / BC7 / ETC2 / RGBA8 for this GPU
  current.refs++;
  let released = false;
  return {
    loader: current.loader,
    release: () => {
      if (released) return;
      released = true;
      if (--current.refs === 0) {
        current.ktx2.dispose();
        if (shared === current) shared = null;
      }
    },
  };
}
