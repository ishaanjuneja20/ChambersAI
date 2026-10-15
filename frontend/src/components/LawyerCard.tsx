import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import type { Lawyer } from "../lib/demoLawyers";
import PlaceholderPortrait from "./PlaceholderPortrait";
import { useImageFallback } from "../hooks/useImageFallback";
import "./LawyerCard.css";

export default function LawyerCard({ lawyer, matched }: { lawyer: Lawyer; matched?: boolean }) {
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const { failed, onError } = useImageFallback();

  return (
    <button type="button" className={`lawyer-card${matched ? " lawyer-card--matched" : ""}`} onClick={() => navigate(`/lawyers/${lawyer.id}`)}>
      <motion.div
        className="lawyer-card__portrait-wrap"
        whileHover={prefersReducedMotion ? undefined : { scale: 1.04, y: -4, boxShadow: "0 8px 24px rgba(46,26,71,0.22)" }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        {failed ? (
          <PlaceholderPortrait seed={lawyer.id} />
        ) : (
          <img src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt="" onError={onError} />
        )}
      </motion.div>
      <p className="lawyer-card__name">{lawyer.name}</p>
      <p className="lawyer-card__practice">{lawyer.practice}</p>
      {matched && <span className="lawyer-card__badge">Best match</span>}
    </button>
  );
}
