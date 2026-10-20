import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

// Reads ?session=<id> from the URL, or mints one and writes it in, so Meet <-> Chat links (and
// My Consultations' "Reopen") can carry the same session id without losing the conversation.
export function useSessionId(): string {
  const [params, setParams] = useSearchParams();
  const idRef = useRef(params.get("session") ?? `sess-${Date.now()}`);

  useEffect(() => {
    if (!params.get("session")) {
      const next = new URLSearchParams(params);
      next.set("session", idRef.current);
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return idRef.current;
}
