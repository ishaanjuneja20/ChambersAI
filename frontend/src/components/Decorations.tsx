import "./Decorations.css";

// Refined, non-interactive page ornament: a faint arched-window motif at the top-right edge, fluted column
// lines down the left edge, and thin gold corner brackets. Pure SVG/CSS (no animation, no JS), positioned at
// the edges so it never sits behind text.
function Arch() {
  const cx = 200;
  return (
    <svg className="decorations__arch" viewBox="0 0 400 620" aria-hidden="true">
      {[170, 138, 106].map((r) => (
        <path key={r} d={`M ${cx - r} 620 V ${r + 20} A ${r} ${r} 0 0 1 ${cx + r} ${r + 20} V 620`} />
      ))}
      <path d={`M ${cx} 20 V 620 M ${cx - 106} 300 H ${cx + 106}`} />
      <path d={`M ${cx - 12} 8 L ${cx} 0 L ${cx + 12} 8 L ${cx} 16 Z`} />
    </svg>
  );
}

function Corner({ className }: { className: string }) {
  return (
    <svg className={`decorations__corner ${className}`} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M1 47 V1 H47" />
      <path d="M9 17 L13 13 L17 17 L13 21 Z" />
    </svg>
  );
}

export default function Decorations() {
  return (
    <div className="decorations" aria-hidden="true">
      <Arch />
      <div className="decorations__columns" />
      <Corner className="decorations__corner--tl" />
      <Corner className="decorations__corner--br" />
    </div>
  );
}
