// Whole-face performance for an ARKit-blendshape avatar: visemes -> mouth morphs, plus restrained eyes,
// brows, head and breathing. Speech accuracy comes first; everything else stays small (calm, precise persona).
import * as THREE from "three";
import { CONTACT_VISEMES, MOUTH_MORPHS, VISEMES, VISEME_RECIPES, VOWEL_VISEMES } from "../../lib/lipsync/visemes";
import type { MouthSample } from "../../lib/lipsync/timeline";

const OTHER_MORPHS = [
  "eyeBlinkLeft", "eyeBlinkRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeLookDownLeft", "eyeLookDownRight",
  "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight", "browInnerUp", "browOuterUpLeft",
  "browOuterUpRight",
];
// Morphs that make lip contact; they snap in faster so P/B/M and F/V visibly close.
const CONTACT_MORPHS = new Set(["mouthClose", "mouthPressLeft", "mouthPressRight", "mouthRollLower", "mouthRollUpper"]);
// Opening morphs scaled by loudness on vowels.
const OPENING_MORPHS = new Set(["jawOpen", "mouthLowerDownLeft", "mouthLowerDownRight"]);
const ATTACK = 0.03;
const CONTACT_ATTACK = 0.016;
const RELEASE = 0.045;
const REST_SMILE = 0.1;
const SEAL_ATTACK = 0.012;
const SEAL_RELEASE = 0.03;
const PP_INDEX = VISEMES.indexOf("PP");
// Morphs that pull the lips apart; a P/B/M seal overrides whatever a neighbouring vowel left on them.
const LIP_PARTING = ["mouthLowerDownLeft", "mouthLowerDownRight", "mouthUpperUpLeft", "mouthUpperUpRight"];

type Slot = { influences: number[]; index: number };

export interface FaceRig {
  meshes: THREE.Mesh[];
  head?: THREE.Object3D;
  chest?: THREE.Object3D;
  leftEye?: THREE.Object3D;
  rightEye?: THREE.Object3D;
}

export class FaceAnimator {
  private slots = new Map<string, Slot[]>();
  private mouth = new Map<string, number>();
  private target = new Map<string, number>();
  private rest = new Map<THREE.Object3D, THREE.Quaternion>();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private speakingAmt = 0;
  private energySlow = 0;
  private nextBlink = 2 + Math.random() * 3;
  private blinkStart = -1;
  private lastBlink = 0;
  private wasSilent = true;
  private gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 1.5 };
  private brow = 0;
  private seal = 0;

  constructor(
    private readonly rig: FaceRig,
    private readonly reduceMotion = false,
  ) {
    for (const name of [...MOUTH_MORPHS, ...OTHER_MORPHS, "mouthSmileLeft", "mouthSmileRight"]) {
      const list: Slot[] = [];
      for (const mesh of rig.meshes) {
        const index = mesh.morphTargetDictionary?.[name];
        if (index !== undefined && mesh.morphTargetInfluences) list.push({ influences: mesh.morphTargetInfluences, index });
      }
      if (list.length) this.slots.set(name, list);
      this.mouth.set(name, 0);
    }
    for (const bone of [rig.head, rig.chest, rig.leftEye, rig.rightEye]) if (bone) this.rest.set(bone, bone.quaternion.clone());
  }

  /** Morph targets the GLB lacks (so the corresponding shapes are approximated or skipped). */
  missingMorphs(): string[] {
    return [...MOUTH_MORPHS, ...OTHER_MORPHS].filter((m) => !this.slots.has(m));
  }

  private set(name: string, value: number) {
    const list = this.slots.get(name);
    if (list) for (const s of list) s.influences[s.index] = value;
  }

  private rotate(bone: THREE.Object3D | undefined, x: number, y: number, z: number) {
    const rest = bone && this.rest.get(bone);
    if (!bone || !rest) return;
    bone.quaternion.copy(rest).multiply(this.q.setFromEuler(this.e.set(x, y, z)));
  }

  /**
   * @param sample   lip-sync state from the driver, or null when nothing is being spoken
   * @param fallbackLevel  loudness 0..1 used only when there is no sample (amplitude-only last resort)
   */
  update(dt: number, t: number, sample: MouthSample | null, fallbackLevel: number): void {
    const speaking = !!sample?.speaking;
    this.speakingAmt += ((speaking ? 1 : 0) - this.speakingAmt) * (1 - Math.exp(-dt / 0.4));

    // ---- mouth targets
    for (const name of MOUTH_MORPHS) this.target.set(name, 0);
    if (sample && !sample.silent) {
      const loud = Math.min(1.15, Math.max(0.6, 0.65 + 0.5 * sample.energy));
      VISEMES.forEach((v, i) => {
        const w = sample.weights[i];
        if (w < 0.001) return;
        const scale = VOWEL_VISEMES.has(v) ? loud : 1;
        for (const [name, value] of Object.entries(VISEME_RECIPES[v])) {
          const s = OPENING_MORPHS.has(name) && !CONTACT_VISEMES.has(v) ? scale : 1;
          this.target.set(name, (this.target.get(name) ?? 0) + w * value * s);
        }
      });
    } else if (!sample && fallbackLevel > 0.02) {
      this.target.set("jawOpen", fallbackLevel * 0.45);
      this.target.set("mouthLowerDownLeft", fallbackLevel * 0.2);
      this.target.set("mouthLowerDownRight", fallbackLevel * 0.2);
    }
    for (const name of MOUTH_MORPHS) {
      if (name === "mouthClose") continue;
      const goal = Math.min(1, this.target.get(name) ?? 0);
      const cur = this.mouth.get(name) ?? 0;
      const tau = goal > cur ? (CONTACT_MORPHS.has(name) ? CONTACT_ATTACK : ATTACK) : RELEASE;
      const next = cur + (goal - cur) * (1 - Math.exp(-dt / tau));
      this.mouth.set(name, next);
      if (name !== "mouthSmileLeft" && name !== "mouthSmileRight") this.set(name, next);
    }
    // Lip seal for P/B/M. ARKit's mouthClose means "lips together while the jaw is open", so it is driven
    // from the jaw's *current* (smoothed) opening: the lips meet on time even while the jaw is still closing.
    const sealGoal = sample && !sample.silent ? Math.min(1, sample.weights[PP_INDEX]) : 0;
    this.seal += (sealGoal - this.seal) * (1 - Math.exp(-dt / (sealGoal > this.seal ? SEAL_ATTACK : SEAL_RELEASE)));
    const jaw = this.mouth.get("jawOpen") ?? 0;
    this.set("mouthClose", Math.min(jaw, this.seal * jaw));
    for (const name of LIP_PARTING) this.set(name, (this.mouth.get(name) ?? 0) * (1 - this.seal));
    // calm resting smile, eased off while talking so it doesn't stretch every vowel
    const smile = REST_SMILE * (1 - 0.6 * this.speakingAmt);
    this.set("mouthSmileLeft", smile + (this.mouth.get("mouthSmileLeft") ?? 0));
    this.set("mouthSmileRight", smile + (this.mouth.get("mouthSmileRight") ?? 0));

    // ---- blinks: every 2.5-6 s, preferably in a pause when speaking
    const silentNow = !sample || sample.silent;
    const pauseStarted = speaking && silentNow && !this.wasSilent;
    this.wasSilent = silentNow;
    if (this.blinkStart < 0 && (t >= this.nextBlink || (pauseStarted && t - this.lastBlink > 1.8 && Math.random() < 0.5))) {
      this.blinkStart = t;
    }
    let blink = 0;
    if (this.blinkStart >= 0) {
      const p = t - this.blinkStart;
      blink = p < 0.06 ? p / 0.06 : p < 0.17 ? 1 - (p - 0.06) / 0.11 : 0;
      if (p >= 0.17) {
        this.blinkStart = -1;
        this.lastBlink = t;
        this.nextBlink = t + 2.5 + Math.random() * 3.5;
      }
    }
    this.set("eyeBlinkLeft", blink);
    this.set("eyeBlinkRight", blink);

    // ---- gaze: small saccades, mostly toward the client
    const g = this.gaze;
    if (!this.reduceMotion && t >= g.next) {
      const range = speaking ? 0.025 : 0.05;
      g.tx = (Math.random() * 2 - 1) * range;
      g.ty = (Math.random() * 2 - 1) * range * 0.6;
      if (Math.random() < 0.4) g.tx = g.ty = 0;
      g.next = t + 1.2 + Math.random() * 2.5;
    }
    g.x += (g.tx - g.x) * (1 - Math.exp(-dt / 0.035));
    g.y += (g.ty - g.y) * (1 - Math.exp(-dt / 0.035));
    this.rotate(this.rig.leftEye, -g.y, g.x, 0);
    this.rotate(this.rig.rightEye, -g.y, g.x, 0);
    const look = (v: number) => Math.min(1, Math.max(0, v * 6));
    this.set("eyeLookUpLeft", look(g.y)); this.set("eyeLookUpRight", look(g.y));
    this.set("eyeLookDownLeft", look(-g.y)); this.set("eyeLookDownRight", look(-g.y));
    // positive yaw turns the eyes toward her right (checked on the model)
    this.set("eyeLookOutRight", look(g.x)); this.set("eyeLookInLeft", look(g.x));
    this.set("eyeLookInRight", look(-g.x)); this.set("eyeLookOutLeft", look(-g.x));

    // ---- brows: a slight lift as each phrase begins, otherwise still
    const energy = sample && !sample.silent ? sample.energy : 0;
    this.energySlow += (energy - this.energySlow) * (1 - Math.exp(-dt / 0.3));
    const phraseLift = speaking && sample!.phraseAge < 0.7 ? 0.12 * (1 - sample!.phraseAge / 0.7) : 0;
    this.brow += (phraseLift - this.brow) * (1 - Math.exp(-dt / 0.15));
    this.set("browInnerUp", this.brow);
    this.set("browOuterUpLeft", this.brow * 0.4);
    this.set("browOuterUpRight", this.brow * 0.4);

    // ---- head and breathing
    if (this.reduceMotion) return;
    const talk = this.speakingAmt;
    this.rotate(
      this.rig.head,
      Math.sin(t * 0.37) * 0.012 + talk * (this.energySlow * 0.02 * Math.sin(t * 1.7) - 0.006),
      Math.sin(t * 0.23) * 0.03 * (1 - 0.4 * talk) + talk * 0.01 * Math.sin(t * 0.9),
      Math.sin(t * 0.31) * 0.008,
    );
    this.rotate(this.rig.chest, Math.sin(t * 1.5) * 0.008, 0, 0);
  }
}
