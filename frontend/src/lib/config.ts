/**
 * Whether a general-guidance answer (the backend's `general: true`, docs/CONTRACTS.md tier 2) is marked for the user: the
 * "General information, not from verified sources" tag, the muted look of the answer, and the line the lawyer says first in
 * voice mode. The owner chose to hide all three (DECISIONS.md); the flag from the backend is still read and carried through.
 * Set to true to bring them back, nothing else changes.
 */
export const SHOW_GENERAL_NOTICE = false;
