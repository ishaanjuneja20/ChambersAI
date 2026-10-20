import { useCallback, useRef, useState } from "react";

// Browser-native SpeechSynthesis only — the browser never calls Gemini or Fish Audio and holds
// no keys. Captions reveal word-by-word on the 'boundary' event where supported, else on a
// simulated fixed-pace fallback.
export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const fallbackIntervalRef = useRef<number>();

  const speak = useCallback(
    (text: string, onWordBoundary: (charIndex: number) => void, onEnd: () => void) => {
      window.clearInterval(fallbackIntervalRef.current);

      if (!supported) {
        setSpeaking(true);
        const words = text.split(/\s+/);
        let wordIndex = 0;
        let charIndex = 0;
        fallbackIntervalRef.current = window.setInterval(() => {
          onWordBoundary(charIndex);
          charIndex += (words[wordIndex]?.length ?? 0) + 1;
          wordIndex += 1;
          if (wordIndex >= words.length) {
            window.clearInterval(fallbackIntervalRef.current);
            setSpeaking(false);
            onEnd();
          }
        }, 220);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.onboundary = (e) => onWordBoundary(e.charIndex);
      utterance.onend = () => {
        setSpeaking(false);
        onEnd();
      };
      utterance.onerror = () => {
        setSpeaking(false);
        onEnd();
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [supported],
  );

  const stop = useCallback(() => {
    window.clearInterval(fallbackIntervalRef.current);
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  return { speak, stop, speaking, supported };
}
