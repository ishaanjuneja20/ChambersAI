import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usesFishVoice } from "../components/avatar3d/lawyerModels";
import { LipSyncDriver } from "../lib/lipsync/driver";
import { detectLang } from "../lib/lipsync/g2p";
import { FishSpeechPlayer } from "../lib/speech/fishSpeech";

// The browser never calls Gemini or Fish Audio directly and holds no keys.
// - Lawyers with a Fish voice, when VITE_TTS_API_URL points at the backend: audio from POST /api/speak,
//   lip-sync from Fish's word timestamps placed on that audio (see lib/speech/fishSpeech.ts).
// - Otherwise (or if that fails): browser-native SpeechSynthesis. Captions reveal word-by-word on the
//   'boundary' event where supported, else on a simulated fixed-pace fallback; the same word events drive
//   an estimated lip-sync.
const TTS_API_URL = import.meta.env.VITE_TTS_API_URL?.replace(/\/$/, "") || "";

export interface SpeakOptions {
  lawyerId?: string;
}

export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const browserSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const fallbackIntervalRef = useRef<number>();
  const lipSync = useMemo(() => new LipSyncDriver(), []);
  const fish = useMemo(() => (TTS_API_URL ? new FishSpeechPlayer(TTS_API_URL, lipSync) : null), [lipSync]);

  useEffect(() => () => fish?.dispose(), [fish]);

  const browserSpeak = useCallback(
    (text: string, onWordBoundary: (charIndex: number) => void, onEnd: () => void) => {
      window.clearInterval(fallbackIntervalRef.current);
      const lang = detectLang(text);
      const generation = lipSync.begin(() => performance.now() / 1000, "speech-synthesis-boundaries");
      const wordAt = (charIndex: number, charLength?: number) =>
        charLength ? text.substr(charIndex, charLength) : text.slice(charIndex).split(/\s/)[0];

      if (!browserSupported) {
        setSpeaking(true);
        const words = text.split(/\s+/);
        let wordIndex = 0;
        let charIndex = 0;
        fallbackIntervalRef.current = window.setInterval(() => {
          onWordBoundary(charIndex);
          lipSync.addWord(generation, words[wordIndex] ?? "", lang, 1.6);
          charIndex += (words[wordIndex]?.length ?? 0) + 1;
          wordIndex += 1;
          if (wordIndex >= words.length) {
            window.clearInterval(fallbackIntervalRef.current);
            lipSync.stop();
            setSpeaking(false);
            onEnd();
          }
        }, 220);
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      // Until the first word event arrives (some voices never send one) keep a plain talking rhythm.
      utterance.onstart = () => lipSync.setSynthetic(generation, true);
      utterance.onboundary = (e) => {
        onWordBoundary(e.charIndex);
        if (e.name === "word" || e.name === undefined) lipSync.addWord(generation, wordAt(e.charIndex, e.charLength), lang, utterance.rate);
      };
      utterance.onend = () => {
        lipSync.stop();
        setSpeaking(false);
        onEnd();
      };
      utterance.onerror = () => {
        lipSync.stop();
        setSpeaking(false);
        onEnd();
      };
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [browserSupported, lipSync],
  );

  const speak = useCallback(
    (text: string, onWordBoundary: (charIndex: number) => void, onEnd: () => void, options: SpeakOptions = {}) => {
      if (fish && options.lawyerId && usesFishVoice(options.lawyerId)) {
        setSpeaking(true);
        fish.speak(text, options.lawyerId, {
          onProgress: onWordBoundary,
          onEnd: () => {
            setSpeaking(false);
            onEnd();
          },
          onFail: (fromChar) => {
            console.warn("[speech] Fish Audio voice unavailable; continuing with the browser voice");
            browserSpeak(text.slice(fromChar), (ci) => onWordBoundary(fromChar + ci), onEnd);
          },
        });
        return;
      }
      browserSpeak(text, onWordBoundary, onEnd);
    },
    [fish, browserSpeak],
  );

  const stop = useCallback(() => {
    window.clearInterval(fallbackIntervalRef.current);
    fish?.stop();
    if (browserSupported) window.speechSynthesis.cancel();
    lipSync.stop();
    setSpeaking(false);
  }, [browserSupported, fish, lipSync]);

  return { speak, stop, speaking, supported: browserSupported || !!fish, lipSync };
}
