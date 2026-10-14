import type { LawyerEntry } from "../lib/contract";
import { useAudioLevel } from "../lib/useAudioLevel";

export type ConsultStatus = "idle" | "listening" | "processing" | "speaking";

interface AvatarProps {
  lawyer: Pick<LawyerEntry, "name" | "avatar">;
  // Stable interface: an audio source to drive lipsync from, or a precomputed level (0..1).
  audioSource?: HTMLMediaElement | MediaStream | null;
  audioLevel?: number;
  status?: ConsultStatus;
  size?: "small" | "large";
}

export default function Avatar({ lawyer, audioSource, audioLevel, status = "idle", size = "large" }: AvatarProps) {
  const liveLevel = useAudioLevel(audioSource ?? null);
  const level = audioLevel ?? liveLevel;
  const mouthOpen = 4 + level * 18;

  return (
    <div className={`avatar avatar--${size} avatar--${status}`}>
      <div className="avatar__portrait">
        <img src={lawyer.avatar || "/avatars/placeholder.svg"} alt={`${lawyer.name}, AI lawyer avatar`} />
        <svg className="avatar__mouth-overlay" viewBox="0 0 200 200" aria-hidden="true">
          <ellipse cx="100" cy="112" rx="16" ry={mouthOpen} fill="#2E1A47" opacity={status === "speaking" ? 0.85 : 0} />
        </svg>
        {status === "listening" && <span className="avatar__ring avatar__ring--listening" />}
        {status === "speaking" && <span className="avatar__ring avatar__ring--speaking" />}
      </div>
    </div>
  );
}
