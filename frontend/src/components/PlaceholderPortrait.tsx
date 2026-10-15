import { UserRound } from "lucide-react";

// Clean illustrated placeholder — never a generated or real face. Used until real portraits land
// at public/lawyers/<id>.jpg.
export default function PlaceholderPortrait({ seed }: { seed: string }) {
  // A few fixed brand-purple tints, deterministically picked per lawyer id so cards stay varied
  // without any randomness between renders.
  const tints = ["#6b3fa0", "#8b5cf6", "#4c2d7a", "#5b3a9e", "#7c4fc9", "#3c2560"];
  const index = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % tints.length;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(160deg, ${tints[index]}, #241536)`,
      }}
      aria-hidden="true"
    >
      <UserRound size="46%" color="rgba(255,255,255,0.85)" strokeWidth={1.4} />
    </div>
  );
}
