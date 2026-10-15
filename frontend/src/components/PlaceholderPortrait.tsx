import { UserRound } from "lucide-react";

// Clean illustrated placeholder — never a generated or real face. Used until real portraits land
// at public/lawyers/<id>.jpg.
export default function PlaceholderPortrait({ seed }: { seed: string }) {
  // A few fixed near-black/graphite tints, deterministically picked per lawyer id so cards stay
  // varied without any randomness between renders. No color — black/white theme only.
  const tints = ["#232329", "#1c1c21", "#28282f", "#1a1a1f", "#26262c", "#202026"];
  const index = Array.from(seed).reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % tints.length;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: `linear-gradient(160deg, ${tints[index]}, #050506)`,
      }}
      aria-hidden="true"
    >
      <UserRound size="46%" color="rgba(255,255,255,0.75)" strokeWidth={1.4} />
    </div>
  );
}
