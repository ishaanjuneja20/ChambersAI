import { useEffect, useRef, useState } from "react";
import GeneralTag from "../GeneralTag";
import { showGeneralNotice } from "../../lib/generalAnswer";
import PageTaggedText from "../PageTaggedText";

export interface LiveCaption {
  text: string;
  visibleChars: number;
  /** A general-guidance answer: the subtitles carry the "General information" tag and are muted. */
  general?: boolean;
}

const FADE_DELAY_MS = 1400; // how long the last sentence lingers after speech ends

// The sentence currently being spoken: from the last sentence end inside the already-spoken text, to the spoken position.
function currentSentence(caption: LiveCaption): { shown: string; full: string } {
  const spoken = caption.text.slice(0, caption.visibleChars).trimEnd();
  if (!spoken) return { shown: "…", full: "" };
  const end = /[.!?।]["')\]]?\s+/g;
  let start = 0;
  for (let m = end.exec(spoken); m; m = end.exec(spoken)) start = m.index + m[0].length;
  const rest = caption.text.slice(start);
  const stop = rest.search(/[.!?।]["')\]]?(\s|$)/);
  return { shown: spoken.slice(start), full: stop === -1 ? rest : rest.slice(0, stop + 1) };
}

// Video-call style subtitles for the lawyer's in-progress answer, driven by the same liveCaption state the transcript uses.
// The text is shown a sentence at a time (the newest words always visible, at most three lines) and fades out shortly after
// speech ends. A visually hidden live region announces each finished sentence once, not every word.
export default function Subtitles({ caption }: { caption: LiveCaption | null }) {
  const last = useRef({ shown: "", full: "" });
  const general = useRef(false);
  const [visible, setVisible] = useState(false);

  if (caption) {
    last.current = currentSentence(caption);
    general.current = showGeneralNotice(caption.general);
  }

  useEffect(() => {
    if (caption) {
      setVisible(true);
      return;
    }
    const t = window.setTimeout(() => setVisible(false), FADE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [caption]);

  return (
    <div className={`room-subtitles${visible ? " room-subtitles--on" : ""}${general.current ? " room-subtitles--general" : ""}`}>
      {general.current && (
        <div className="room-subtitles__general">
          <GeneralTag />
        </div>
      )}
      <div className="room-subtitles__strip" aria-hidden="true">
        <span>
          <PageTaggedText text={last.current.shown} />
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {visible ? last.current.full : ""}
      </p>
    </div>
  );
}
