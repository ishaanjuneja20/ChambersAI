import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { ConsultStatus } from "../../lib/consultTypes";
import type { LawyerModel } from "./lawyerModels";
import { FaceAnimator } from "./faceAnimator";
import type { LipSyncDriver } from "../../lib/lipsync/driver";
import "./CourtroomAvatar.css";

interface CourtroomAvatarProps {
  model: LawyerModel;
  name: string;
  level: number; // 0..1 speech loudness; last-resort mouth driver when there is no lip-sync timing
  status: ConsultStatus;
  lipSync?: LipSyncDriver; // viseme timing; without it the mouth follows `level` only
  onError?: () => void;
}

// Framing, in metres, matched to the composition reference: head near the top quarter, judge's bench
// visible behind, a desk across the bottom edge. The model is a standing avatar; the desk hides the legs.
const FOV = 22;
const VIEW_HEIGHT = 0.8; // world height visible at the model's plane
const HEAD_TOP_FROM_TOP = 0.22; // fraction of the frame above the top of the hair
const DESK_BACK_FROM_TOP = 0.93; // where the back edge of the desk sits in the frame
const DESK_BACK_Z = 0.2;
const DESK_DEPTH = 0.75;

function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3) {
  bone.updateWorldMatrix(true, true);
  const from = bone.getWorldPosition(new THREE.Vector3());
  const current = child.getWorldPosition(new THREE.Vector3()).sub(from).normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(current, dir.clone().normalize());
  const world = turn.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentWorld.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

// Two-bone IK: bring the arms down from the T-pose so the forearms rest on the desk and the hands meet
// in front of the body (+X is the avatar's left, +Z faces the camera). Bones are only rotated, never scaled.
function poseArms(root: THREE.Object3D, deskY: number) {
  const get = (n: string) => root.getObjectByName(n);
  const pos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  root.updateWorldMatrix(true, true);
  for (const [side, sign] of [["Left", 1], ["Right", -1]] as const) {
    const arm = get(`${side}Arm`);
    const fore = get(`${side}ForeArm`);
    const hand = get(`${side}Hand`);
    if (!arm || !fore || !hand) continue;
    const shoulder = pos(arm);
    const upperLen = shoulder.distanceTo(pos(fore));
    const foreLen = pos(fore).distanceTo(pos(hand));
    const target = new THREE.Vector3(sign * 0.07, deskY + 0.03, DESK_BACK_Z + 0.18);
    const toTarget = target.clone().sub(shoulder);
    const d = Math.min(toTarget.length(), (upperLen + foreLen) * 0.999);
    const u = toTarget.normalize();
    const a = (upperLen * upperLen - foreLen * foreLen + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, upperLen * upperLen - a * a));
    const pole = new THREE.Vector3(sign * 0.6, -1, -0.3);
    pole.sub(u.clone().multiplyScalar(pole.dot(u))).normalize(); // elbows out and down
    const elbow = shoulder.clone().addScaledVector(u, a).addScaledVector(pole, h);
    aimBone(arm, fore, elbow.clone().sub(shoulder));
    aimBone(fore, hand, target.clone().sub(elbow));
  }
}

function buildDesk(deskY: number): THREE.Group {
  const desk = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x1a0b04, roughness: 0.22, metalness: 0.05 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x120804, roughness: 0.5 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x9a7440, roughness: 0.35, metalness: 0.85 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(4, 0.05, DESK_DEPTH), wood);
  top.position.set(0, deskY - 0.025, DESK_BACK_Z + DESK_DEPTH / 2);
  const front = new THREE.Mesh(new THREE.BoxGeometry(4, deskY - 0.05, 0.04), panel);
  front.position.set(0, (deskY - 0.05) / 2, DESK_BACK_Z + DESK_DEPTH - 0.04);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(4, 0.012, 0.012), brass);
  trim.position.set(0, deskY - 0.056, DESK_BACK_Z + DESK_DEPTH + 0.001);
  desk.add(top, front, trim);
  return desk;
}

export default function CourtroomAvatar({ model, name, level, status, lipSync, onError }: CourtroomAvatarProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  const onErrorRef = useRef(onError);
  const lipSyncRef = useRef(lipSync);
  const [loaded, setLoaded] = useState(false);

  levelRef.current = level;
  onErrorRef.current = onError;
  lipSyncRef.current = lipSync;

  // Which timing method drives the mouth, visible as data-lipsync on the stage (and in the console).
  useEffect(() => {
    if (!lipSync) return;
    const show = (method: string) => {
      stageRef.current?.setAttribute("data-lipsync", method);
      if (method !== "idle") console.info(`[lip-sync] ${method}`);
    };
    show(lipSync.method);
    return lipSync.onMethodChange(show);
  }, [lipSync]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      onErrorRef.current?.();
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    scene.environmentIntensity = 0.3;

    // Warm courtroom light: overhead spots in front, wall sconces behind for a rim.
    scene.add(new THREE.HemisphereLight(0xffe0bd, 0x2a140a, 1.0));
    const key = new THREE.DirectionalLight(0xffd3a3, 2.1);
    key.position.set(1.2, 2.8, 3);
    const fill = new THREE.DirectionalLight(0xffe6cf, 0.55);
    fill.position.set(-2.2, 1.8, 2.2);
    const rim = new THREE.DirectionalLight(0xffa860, 1.8);
    rim.position.set(0.4, 2.6, -2.5);
    scene.add(key, fill, rim);

    const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.05, 20);

    const resize = () => {
      const { width, height } = stage.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    resize();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let face: FaceAnimator | undefined;
    let avatar: THREE.Object3D | undefined;
    let disposed = false;

    new GLTFLoader().load(
      model.modelUrl,
      (gltf) => {
        if (disposed) return;
        avatar = gltf.scene;
        const morphMeshes: THREE.Mesh[] = [];
        avatar.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.frustumCulled = false; // skinned bounds don't follow the re-posed arms
          if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) morphMeshes.push(mesh);
        });
        const headTop = new THREE.Box3().setFromObject(avatar).max.y;
        const frameTop = headTop + HEAD_TOP_FROM_TOP * VIEW_HEIGHT;
        const centerY = frameTop - VIEW_HEIGHT / 2;
        const halfTan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const distance = VIEW_HEIGHT / 2 / halfTan;
        camera.position.set(0, centerY, distance);
        camera.lookAt(0, centerY, 0);
        // Height at which the desk's back edge lands at DESK_BACK_FROM_TOP of the frame.
        const deskY = centerY - (DESK_BACK_FROM_TOP - 0.5) * 2 * (distance - DESK_BACK_Z) * halfTan;

        poseArms(avatar, deskY);
        face = new FaceAnimator(
          {
            meshes: morphMeshes,
            head: avatar.getObjectByName("Head"),
            chest: avatar.getObjectByName("Spine2"),
            leftEye: avatar.getObjectByName("LeftEye"),
            rightEye: avatar.getObjectByName("RightEye"),
          },
          reduceMotion,
        );
        const missing = face.missingMorphs();
        if (missing.length) console.warn("[lip-sync] model lacks morph targets:", missing.join(", "));
        scene.add(avatar, buildDesk(deskY));
        setLoaded(true);
      },
      undefined,
      () => {
        if (!disposed) onErrorRef.current?.();
      },
    );

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1);
      face?.update(dt, clock.elapsedTime, lipSyncRef.current?.sample() ?? null, levelRef.current);
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      });
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [model.modelUrl]);

  return (
    <div
      ref={stageRef}
      className={`courtroom courtroom--${status}`}
      style={{ backgroundImage: `url("${model.backgroundUrl}")` }}
      role="img"
      aria-label={`${name}, AI advocate persona, seated in a courtroom`}
    >
      <canvas ref={canvasRef} className="courtroom__canvas" />
      {!loaded && <div className="courtroom__loading">Preparing the courtroom…</div>}
    </div>
  );
}
