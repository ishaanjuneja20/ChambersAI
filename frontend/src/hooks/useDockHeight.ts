import { useCallback, useRef } from "react";

// Publishes an element's height as --dock-h on the enclosing .room (no React state, so no re-render): the live page's subtitles, the
// chat thread's bottom padding and the mobile sheet use it to stay clear of the floating composer / dock.
export function useDockHeight() {
  const observer = useRef<ResizeObserver>();
  return useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    const room = el?.closest<HTMLElement>(".room");
    if (!el || !room) return;
    const apply = () => room.style.setProperty("--dock-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    observer.current = new ResizeObserver(apply);
    observer.current.observe(el);
  }, []);
}
