import { lazy, Suspense, useState } from "react";
import type { Lawyer } from "../lib/demoLawyers";
import type { ConsultStatus } from "../lib/consultTypes";
import { useAudioLevel } from "../hooks/useAudioLevel";
import { useImageFallback } from "../hooks/useImageFallback";
import PlaceholderPortrait from "./PlaceholderPortrait";
import { getLawyerModel } from "./avatar3d/lawyerModels";
import type { LipSyncDriver } from "../lib/lipsync/driver";
import "./Avatar.css";

// three.js is only downloaded when a lawyer with a 3D model is opened.
const CourtroomAvatar = lazy(() => import("./avatar3d/CourtroomAvatar"));

// Stable interface for swapping in a real lip-sync renderer later (e.g. a .glb-based SDK) —
// callers only ever provide a lawyer, an audio source/level, and a status.
interface AvatarProps {
  lawyer: Pick<Lawyer, "id" | "name" | "avatarUrl">;
  audioSource?: HTMLMediaElement | MediaStream | null;
  audioLevel?: number;
  status?: ConsultStatus;
  size?: "small" | "large";
  lipSync?: LipSyncDriver; // viseme timing for 3D lawyers
  onReady?: () => void; // the 3D scene has rendered its first real frame
  onModelFailed?: () => void; // the 3D model couldn't load: the 2D portrait is showing instead
}

export default function Avatar({ lawyer, audioSource, audioLevel, status = "idle", size = "large", lipSync, onReady, onModelFailed }: AvatarProps) {
  const liveLevel = useAudioLevel(audioSource ?? null);
  const level = audioLevel ?? liveLevel;
  const mouthOpenRy = 4 + level * 16;
  const { failed, onError } = useImageFallback();
  const model = size === "large" ? getLawyerModel(lawyer.id) : undefined;
  const [modelFailed, setModelFailed] = useState(false);

  if (model && !modelFailed) {
    return (
      <div className="avatar avatar--stage">
        <Suspense fallback={<div className="avatar__stage-loading" />}>
          <CourtroomAvatar
            model={model}
            name={lawyer.name}
            level={level}
            status={status}
            lipSync={lipSync}
            onReady={onReady}
            onError={() => {
              setModelFailed(true);
              onModelFailed?.();
            }}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className={`avatar avatar--${size}`}>
      <div className="avatar__portrait">
        {failed ? (
          <PlaceholderPortrait seed={lawyer.id} />
        ) : (
          <img src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt={lawyer.name} onError={onError} />
        )}
        <svg className="avatar__mouth-overlay" viewBox="0 0 200 200" aria-hidden="true">
          <ellipse cx="100" cy="128" rx="18" ry={mouthOpenRy} style={{ fill: "var(--bg)" }} opacity={status === "speaking" ? 0.8 : 0} />
        </svg>
        {status === "listening" && <span className="avatar__ring avatar__ring--listening" />}
        {status === "speaking" && <span className="avatar__ring avatar__ring--speaking" />}
      </div>
    </div>
  );
}
