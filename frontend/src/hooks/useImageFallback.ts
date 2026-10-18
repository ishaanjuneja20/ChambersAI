import { useState } from "react";

export function useImageFallback() {
  const [failed, setFailed] = useState(false);
  return { failed, onError: () => setFailed(true) };
}
