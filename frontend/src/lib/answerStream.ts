// Turns the backend's answer events into what a page shows: sentences as they arrive, the numbered sources so far, and exactly one
// ending (complete, refused or failed). Kept apart from the React hook so it can be tested without a browser.
//
// A request that fails, times out, ends without a final event, or finishes without a single sentence is a failure: the page is told
// (onFailure) and the person sees ASK_FAILED_MESSAGE, never a blank answer or a spinner that never stops.
import { ASK_FAILED_MESSAGE, askStream, type AskCitation, type AskRequest } from "./askApi";
import type { Citation, TurnKind } from "./consultTypes";

/** What kind of turn the answer is, and the questions to offer under it. Passed along to addLawyerTurn. */
export interface AnswerOutcome {
  kind?: TurnKind;
  suggestions?: string[];
  /** A general-guidance answer: unverified, no citations. */
  general?: boolean;
}

/** What a page does with a streamed answer. Citations are the cumulative list so far, numbered as the [n] markers in the text. */
export interface AnswerHandlers {
  /** `general` is set on every sentence of a general-guidance answer. */
  onSentence: (sentence: { text: string; speak: string; general?: boolean }, citations: Citation[]) => void;
  /** No reliable source: `answer` is shown (and spoken) as is. Nothing else was sent before it. */
  onRefused: (answer: string, outcome: AnswerOutcome) => void;
  /** The answer is complete; `citations` is the full numbered list (empty for the in-app intro and for a general answer). */
  onComplete: (citations: Citation[], outcome: AnswerOutcome) => void;
  /** The request failed, possibly after some sentences. The notice has already been set to ASK_FAILED_MESSAGE. */
  onFailure: (citations: Citation[], outcome: AnswerOutcome) => void;
}

// The backend only returns sections / cases it found in the retrieved sources (CLAUDE.md rules 2 and 3), so a
// citation that arrives is a verified one.
const toCitation = (c: AskCitation): Citation => ({ marker: c.n, label: c.text, confidence: "verified" });

export interface RunAnswerStream {
  request: AskRequest;
  handlers: AnswerHandlers;
  /** The questions offered after a refusal. */
  refusalSuggestions: string[];
  /** The sources of the answer so far, for the sources panel. */
  setLiveCitations: (citations: Citation[]) => void;
  setNotice: (notice: string | null) => void;
  /** For tests; defaults to the real endpoint. */
  ask?: typeof askStream;
}

/** Resolves once the answer has ended one way or another. Nothing is called after `request.signal` aborts. */
export async function runAnswerStream({ request, handlers, refusalSuggestions, setLiveCitations, setNotice, ask = askStream }: RunAnswerStream): Promise<void> {
  const live = () => !request.signal?.aborted;
  let collected: Citation[] = [];
  let sentences = 0;
  let general = false;
  let ended = false;
  const outcome = (): AnswerOutcome => (general ? { general: true } : {});

  const fail = () => {
    ended = true;
    setNotice(ASK_FAILED_MESSAGE);
    handlers.onFailure(collected, outcome());
  };

  try {
    for await (const event of ask(request)) {
      if (!live()) return;
      if (event.type === "sentence") {
        sentences++;
        general ||= event.general === true;
        if (!general) collected = [...collected, ...event.newCitations.filter((c) => !collected.some((k) => k.marker === c.n)).map(toCitation)];
        setLiveCitations(collected);
        handlers.onSentence({ text: event.text, speak: event.speak, ...(general ? { general: true } : {}) }, collected);
      } else if (event.type === "refused") {
        ended = true;
        handlers.onRefused(event.answer, { kind: "refusal", suggestions: refusalSuggestions });
      } else if (event.type === "done") {
        if (sentences === 0) {
          fail(); // "done" with nothing to show would be a blank answer
          continue;
        }
        ended = true;
        general ||= event.general === true;
        if (general) collected = [];
        else if (event.citations.length) collected = event.citations.map(toCitation); // the full numbered list
        setLiveCitations(collected);
        handlers.onComplete(collected, outcome());
      } else {
        fail();
      }
    }
    if (!ended && live()) fail(); // the connection closed without a final event
  } catch (error) {
    if (!live()) return; // aborted
    if (ended) console.error("[ask] handler failed", error);
    else fail();
  }
}
