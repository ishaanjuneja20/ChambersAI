import { useEffect, useState } from "react";
import { useMediaQuery } from "./useMediaQuery";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function write(key: string, open: boolean) {
  try {
    localStorage.setItem(key, open ? "1" : "0");
  } catch {
    /* ignore: private browsing or blocked storage, the choice just won't persist */
  }
}

// The room's side panel: on wide screens it is a column whose open / closed state is remembered; on tablets and phones it is a drawer /
// bottom sheet that starts closed. Esc closes the drawer / sheet.
export function useRoomPanel(storageKey: string) {
  const wide = useMediaQuery("(min-width: 1100px)");
  const [wideOpen, setWideOpen] = useState(() => read(storageKey));
  const [overlayOpen, setOverlayOpen] = useState(false);
  const panelOpen = wide ? wideOpen : overlayOpen;

  const toggle = () => {
    if (wide) {
      write(storageKey, !wideOpen);
      setWideOpen(!wideOpen);
    } else setOverlayOpen((open) => !open);
  };

  useEffect(() => {
    if (wide || !overlayOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOverlayOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, overlayOpen]);

  return { panelOpen, overlayOpen, setOverlayOpen, toggle };
}
