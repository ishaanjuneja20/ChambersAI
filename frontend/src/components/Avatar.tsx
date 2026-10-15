import type { Lawyer } from "../lib/demoLawyers";
import type { ConsultStatus } from "../lib/consultTypes";
import { useAudioLevel } from "../hooks/useAudioLevel";
import { useImageFallback } from "../hooks/useImageFallback";
import PlaceholderPortrait from "./PlaceholderPortrait";
import "./Avatar.css";

// Stable interface for swapping in a real lip-sync renderer later (e.g. a .glb-based SDK) —
// callers only ever provide a lawyer, an audio source/level, and a status.
interface AvatarProps {
  lawyer: Pick<Lawyer, "id" | "name" | "avatarUrl">;
  audioSource?: HTMLMediaElement | MediaStream | null;
  audioLevel?: number;
  status?: ConsultStatus;
  size?: "small" | "large";
}

export default function Avatar({ lawyer, audioSource, audioLevel, status = "idle", size = "large" }: AvatarProps) {
  const liveLevel = useAudioLevel(audioSource ?? null);
  const level = audioLevel ?? liveLevel;
  const mouthOpenRy = 4 + level * 16;
  const { failed, onError } = useImageFallback();

  return (
    <div className={`avatar avatar--${size}`}>
      <div className="avatar__portrait">
        {failed ? (
          <PlaceholderPortrait seed={lawyer.id} />
        ) : (
          <img src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt={`${lawyer.name}, AI advocate persona`} onError={onError} />
        )}
        <svg className="avatar__mouth-overlay" viewBox="0 0 200 200" aria-hidden="true">
          <ellipse cx="100" cy="128" rx="18" ry={mouthOpenRy} fill="#050506" opacity={status === "speaking" ? 0.8 : 0} />
        </svg>
        {status === "listening" && <span className="avatar__ring avatar__ring--listening" />}
        {status === "speaking" && <span className="avatar__ring avatar__ring--speaking" />}
      </div>
    </div>
  );
}
