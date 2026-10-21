import { useCallback, useRef, useState } from "react";

// Browser SpeechRecognition only, used purely to show a live caption preview and to produce the
// text VoiceButton reports back. Entirely optional — callers must work fine when `supported` is
// false (no backend STT exists; the mic still works for recording via useVoiceInput).
export function useLiveTranscript() {
  const supported = typeof window !== "undefined" && Boolean((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
  const [text, setText] = useState("");
  const recognitionRef = useRef<any>(null);
  const finalRef = useRef("");

  const start = useCallback(
    (lang: string = "en-IN") => {
      if (!supported) return;
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      finalRef.current = "";
      setText("");
      recognition.onresult = (event: any) => {
        let interim = "";
        let final = finalRef.current;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += `${chunk} `;
          else interim += chunk;
        }
        finalRef.current = final;
        setText(`${final}${interim}`.trim());
      };
      recognition.onerror = () => {
        /* ignore: caller falls back to whatever was captured so far on stop */
      };
      recognitionRef.current = recognition;
      recognition.start();
    },
    [supported],
  );

  const stop = useCallback((): string => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    return (finalRef.current || text).trim();
  }, [text]);

  const cancel = useCallback(() => {
    try {
      recognitionRef.current?.abort();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setText("");
  }, []);

  return { supported, text, start, stop, cancel };
}
