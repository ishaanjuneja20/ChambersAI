// A general-guidance answer (docs/CONTRACTS.md, tier 2) is unverified general information: it has no citations. While
// SHOW_GENERAL_NOTICE is on it is shown with a tag, in a muted style, and in voice mode the lawyer says so before the answer.
import { SHOW_GENERAL_NOTICE } from "./config";

/** The small tag above a general answer. */
export const GENERAL_TAG = "General information, not from verified sources";

const SPOKEN_NOTICE = { en: "This is general information, not from my verified sources.", hi: "यह सामान्य जानकारी है, मेरे सत्यापित स्रोतों से नहीं।" };

/** Whether a turn or caption marked `general` shows the tag and the muted look: only while the notice is on. `show` is for tests. */
export const showGeneralNotice = (general: boolean | undefined, show: boolean = SHOW_GENERAL_NOTICE): boolean => show && general === true;

/** What the lawyer says before a general answer, or null while the notice is off: in Hindi when the answer's first sentence is written in Devanagari, else in English. */
export const generalSpokenNotice = (firstSentence: string, show: boolean = SHOW_GENERAL_NOTICE): string | null =>
  !show ? null : /[\u0900-\u097F]/.test(firstSentence) ? SPOKEN_NOTICE.hi : SPOKEN_NOTICE.en;
