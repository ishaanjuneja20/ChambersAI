import { useEffect, useRef, useState } from "react";

// RMS loudness (0..1) of a playing <audio>/<video> element or a MediaStream, for a
// loudness-driven mouth animation. Kept generic so a real TTS audio source (from the backend)
// can be swapped in later without changing the Avatar component's interface.
export function useAudioLevel(source: HTMLMediaElement | MediaStream | null): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (!source) {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const data = new Uint8Array(analyser.frequencyBinCount);

    let node: MediaStreamAudioSourceNode | MediaElementAudioSourceNode;
    try {
      node = source instanceof MediaStream ? ctx.createMediaStreamSource(source) : ctx.createMediaElementSource(source);
      node.connect(analyser);
      if (!(source instanceof MediaStream)) analyser.connect(ctx.destination);
    } catch {
      return;
    }

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setLevel(Math.min(1, rms * 4));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try {
        node.disconnect();
        analyser.disconnect();
        ctx.close();
      } catch {
        /* ignore */
      }
    };
  }, [source]);

  return level;
}
