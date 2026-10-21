import "./RotatingBadge.css";

const TEXT = "ChambersAI • Indian law • ";
const RADIUS = 48;

// Small decorative circular text badge with a four-pointed star at its center, slowly rotating.
// Purely ornamental — aria-hidden, takes no space from surrounding content.
export default function RotatingBadge() {
  const pathId = "rotating-badge-path";

  return (
    <div className="rotating-badge" aria-hidden="true">
      <svg className="rotating-badge__ring" viewBox="0 0 108 108">
        <path id={pathId} d={`M 54,${54 - RADIUS} A ${RADIUS},${RADIUS} 0 1 1 53.99,${54 - RADIUS}`} fill="none" />
        <text>
          <textPath href={`#${pathId}`}>{TEXT.repeat(2)}</textPath>
        </text>
      </svg>
      <svg className="rotating-badge__star" width="20" height="20" viewBox="0 0 22 22">
        <path d="M11 0 L13 9 L22 11 L13 13 L11 22 L9 13 L0 11 L9 9 Z" fill="var(--gold)" />
      </svg>
    </div>
  );
}
