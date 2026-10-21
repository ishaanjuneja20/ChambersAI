import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import type { Lawyer } from "../lib/demoLawyers";
import PlaceholderPortrait from "./PlaceholderPortrait";
import { useImageFallback } from "../hooks/useImageFallback";
import { useSpotlight } from "../hooks/useSpotlight";
import { prefetchLawyerModel } from "./avatar3d/modelPrefetch";
import "./LawyerCard.css";

export default function LawyerCard({ lawyer, matched }: { lawyer: Lawyer; matched?: boolean }) {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const { failed, onError } = useImageFallback();
  const spotlightRef = useSpotlight<HTMLButtonElement>();

  return (
    <button
      ref={spotlightRef}
      type="button"
      className={`lawyer-card spotlight-card${matched ? " lawyer-card--matched" : ""}`}
      onClick={() => navigate(`/lawyers/${lawyer.id}`)}
      onPointerEnter={() => prefetchLawyerModel(lawyer.id)} // warm the 3D model for the Meet screen
      onFocus={() => prefetchLawyerModel(lawyer.id)}
    >
      <motion.div
        className="lawyer-card__portrait-wrap"
        whileHover={prefersReducedMotion ? undefined : { scale: 1.04, y: -4 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        {failed ? (
          <PlaceholderPortrait seed={lawyer.id} />
        ) : (
          <img className="lawyer-card__photo" src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt="" onError={onError} />
        )}
      </motion.div>
      <p className="lawyer-card__name">{lawyer.name}</p>
      <p className="lawyer-card__practice">{lawyer.practice}</p>
      {matched && <span className="lawyer-card__badge">Best match</span>}
    </button>
  );
}
