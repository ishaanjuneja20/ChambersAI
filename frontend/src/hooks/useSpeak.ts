import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usesFishVoice } from "../components/avatar3d/lawyerModels";
import { LipSyncDriver } from "../lib/lipsync/driver";
import { detectLang, type Lang } from "../lib/lipsync/g2p";
import { CAPTION_JOINER, FishSpeechPlayer, revealIndex, type FishStreamCallbacks, type StreamSentence } from "../lib/speech/fishSpeech";

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

/** An answer being spoken while it still arrives (see speakStream). */
export interface SpeechStream {
  enqueue: (sentence: StreamSentence) => void;
  finish: () => void;
}

export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const browserSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const fallbackIntervalRef = useRef<number>();
  const browserStreamEnd = useRef<(() => void) | null>(null); // ends the browser-voice stream in progress
  const lipSync = useMemo(() => new LipSyncDriver(), []);
  const fish = useMemo(() => (TTS_API_URL ? new FishSpeechPlayer(TTS_API_URL, lipSync) : null), [lipSync]);

  // Leaving the page silences whatever is still being said, whichever voice it was.
  useEffect(
    () => () => {
      fish?.dispose();
      window.clearInterval(fallbackIntervalRef.current);
      browserStreamEnd.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      lipSync.stop();
    },
    [fish, lipSync],
  );

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

  // Browser voice for an answer that is still arriving: one utterance per sentence, queued by the browser itself.
  const browserStream = useCallback(
    (cb: FishStreamCallbacks): SpeechStream => {
      window.clearInterval(fallbackIntervalRef.current);
      browserStreamEnd.current?.();
      if (browserSupported) window.speechSynthesis.cancel();
      const generation = lipSync.begin(() => performance.now() / 1000, "speech-synthesis-boundaries");
      let captionEnd = 0;
      let count = 0;
      let pending = 0;
      let finished = false;
      let ended = false;
      let lang: Lang | null = null;
      const end = () => {
        if (ended) return;
        ended = true;
        if (browserStreamEnd.current === end) browserStreamEnd.current = null;
        lipSync.stop();
        setSpeaking(false);
        cb.onEnd();
      };
      browserStreamEnd.current = end;
      setSpeaking(true);
      return {
        enqueue: ({ caption, speak: spoken }) => {
          if (ended || finished) return;
          const start = count ? captionEnd + CAPTION_JOINER.length : 0;
          captionEnd = start + caption.length;
          count++;
          const sentenceEnd = captionEnd;
          if (!browserSupported || !spoken.trim()) {
            cb.onProgress(sentenceEnd); // nothing to say it with: the caption is simply shown
            return;
          }
          lang ??= detectLang(spoken);
          const wordLang = lang;
          const utterance = new SpeechSynthesisUtterance(spoken);
          utterance.rate = 1;
          pending++;
          const done = () => {
            if (ended) return;
            cb.onProgress(sentenceEnd);
            if (--pending === 0 && finished) end();
          };
          utterance.onstart = () => lipSync.setSynthetic(generation, true);
          utterance.onboundary = (e) => {
            if (ended) return;
            cb.onProgress(revealIndex(caption, 0, caption.length, e.charIndex / spoken.length) + start);
            if (e.name === "word" || e.name === undefined) {
              lipSync.addWord(generation, e.charLength ? spoken.substr(e.charIndex, e.charLength) : spoken.slice(e.charIndex).split(/\s/)[0], wordLang, utterance.rate);
            }
          };
          utterance.onend = done;
          utterance.onerror = done;
          window.speechSynthesis.speak(utterance);
        },
        finish: () => {
          finished = true;
          if (pending === 0) end();
        },
      };
    },
    [browserSupported, lipSync],
  );

  /**
   * Speaks an answer sentence by sentence while it is still being received. `cb.onProgress` reports how many
   * characters of the captions (enqueued captions joined with CAPTION_JOINER) have been spoken; `cb.onEnd`
   * fires after finish() once the last sentence was heard, or when stop() cuts the answer off.
   */
  const speakStream = useCallback(
    (lawyerId: string, cb: FishStreamCallbacks): SpeechStream => {
      if (fish && usesFishVoice(lawyerId)) {
        setSpeaking(true);
        fish.begin(lawyerId, {
          onProgress: cb.onProgress,
          onEnd: () => {
            setSpeaking(false);
            cb.onEnd();
          },
        });
        return { enqueue: (sentence) => fish.enqueue(sentence), finish: () => fish.finish() };
      }
      return browserStream(cb);
    },
    [fish, browserStream],
  );

  const stop = useCallback(() => {
    window.clearInterval(fallbackIntervalRef.current);
    fish?.stop();
    if (browserSupported) window.speechSynthesis.cancel();
    lipSync.stop();
    setSpeaking(false);
    browserStreamEnd.current?.(); // an answer cut off before finish() still ends
  }, [browserSupported, fish, lipSync]);

  return { speak, speakStream, stop, speaking, supported: browserSupported || !!fish, lipSync };
}
