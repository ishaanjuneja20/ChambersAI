import { useCallback, useRef, useState } from "react";

// Hold-to-talk using the browser's SpeechRecognition where available (Chrome/Edge). There is no
// backend STT endpoint today (demo mode and the proposed /match both take plain text), so this
// stays entirely client-side; a typed fallback must always be offered alongside it.
export function useSpeechInput(lang: "en" | "hi" = "en") {
  const [recording, setRecording] = useState(false);
  const [supported] = useState(() => typeof window !== "undefined" && Boolean((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition));
  const recognitionRef = useRef<any>(null);

  const start = useCallback((onResult: (text: string) => void) => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = lang === "hi" ? "hi-IN" : "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const text = Array.from(event.results as any)
        .map((r: any) => r[0].transcript)
        .join(" ");
      onResult(text);
    };
    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognitionRef.current = recognition;
    recognition.start();
    setRecording(true);
  }, [lang]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setRecording(false);
  }, []);

  return { supported, recording, start, stop };
}
