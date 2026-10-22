import { GENERAL_TAG } from "../lib/generalAnswer";
import "./GeneralTag.css";

// The small label above a general-guidance answer (unverified, no sources). The answer itself is muted by the page's own
// `--general` class, see GeneralTag.css.
export default function GeneralTag({ className = "" }: { className?: string }) {
  return <span className={`general-tag ${className}`.trim()}>{GENERAL_TAG}</span>;
}
