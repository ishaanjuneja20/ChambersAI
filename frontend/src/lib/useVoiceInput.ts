import { useCallback, useRef, useState } from "react";

// Owns microphone capture for every mic button in the app: a MediaRecorder (webm/opus, uploaded to the
// backend's speech-to-text by VoiceButton) and a Web Audio AnalyserNode exposing live level/frequency
// data via a ref (not React state), so a canvas animation loop can read it every frame without
// causing re-renders. No audio is ever stored beyond this hook's own lifetime — stop()/cancel()
// release the mic and all tracks immediately.
export type VoiceInputStatus = "idle" | "requesting" | "listening" | "error";

export interface UseVoiceInputResult {
  status: VoiceInputStatus;
  error: string | null;
  supported: boolean;
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  /** Resolves true once the microphone is recording, false if it could not be started (error says why). */
  start: () => Promise<boolean>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}

export function useVoiceInput(): UseVoiceInputResult {
  const [status, setStatus] = useState<VoiceInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const supported =
    typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const release = useCallback(() => {
    recorderRef.current = null;
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {
        /* ignore */
      });
      audioCtxRef.current = null;
    }
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setError("Voice input isn't supported in this browser.");
      setStatus("error");
      return false;
    }
    setError(null);
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;
      recorder.start();

      setStatus("listening");
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      const message =
        name === "NotAllowedError" || name === "PermissionDeniedError"
          ? "Microphone access was denied. Please type your question."
          : name === "NotFoundError"
            ? "No microphone was found. Please type your question."
            : "Couldn't use the microphone. Please type your question.";
      setError(message);
      setStatus("error");
      release();
      return false;
    }
  }, [supported, release]);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        release();
        setStatus("idle");
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: recorder.mimeType }) : null;
        release();
        setStatus("idle");
        resolve(blob);
      };
      recorder.stop();
    });
  }, [release]);

  const cancel = useCallback(() => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    } catch {
      /* ignore */
    }
    release();
    setStatus("idle");
  }, [release]);

  return { status, error, supported, analyserRef, start, stop, cancel };
}
