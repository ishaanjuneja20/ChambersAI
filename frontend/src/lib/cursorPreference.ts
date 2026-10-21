export type CursorPreference = "custom" | "system";

const STORAGE_KEY = "chambersai.cursor";
const HTML_CLASS = "cursor-custom";

// The ChambersAI cursor is the default; "system" is only ever an explicit choice from Profile & Settings.
export function getCursorPreference(): CursorPreference {
  try {
    return localStorage.getItem(STORAGE_KEY) === "system" ? "system" : "custom";
  } catch {
    return "custom";
  }
}

// Adds or removes the class that styles.css keys the cursor images on. Safe to call repeatedly.
export function applyCursorPreference(pref: CursorPreference) {
  document.documentElement.classList.toggle(HTML_CLASS, pref === "custom");
}

export function setCursorPreference(pref: CursorPreference) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* ignore: private browsing or blocked storage, the choice just won't persist */
  }
  applyCursorPreference(pref);
}

// False when localStorage is blocked, so the settings page can say the choice won't be remembered.
export function isCursorPreferenceRemembered(): boolean {
  try {
    const probe = `${STORAGE_KEY}.probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
