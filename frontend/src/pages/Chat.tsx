import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, Plus, Radio } from "lucide-react";
import AttachmentChips from "../components/AttachmentChips";
import GeneralTag from "../components/GeneralTag";
import { showGeneralNotice } from "../lib/generalAnswer";
import DocumentBanner from "../components/DocumentBanner";
import PageTaggedText from "../components/PageTaggedText";
import HandoffBanner from "../components/HandoffBanner";
import StarterChips from "../components/StarterChips";
import PlaceholderPortrait from "../components/PlaceholderPortrait";
import RoomPanel from "../components/meet/RoomPanel";
import RoomTopBar from "../components/meet/RoomTopBar";
import { useConsultationSession, type AnswerOutcome } from "../hooks/useConsultationSession";
import { useDockHeight } from "../hooks/useDockHeight";
import { useImageFallback } from "../hooks/useImageFallback";
import { useRoomPanel } from "../hooks/useRoomPanel";
import { useSessionId } from "../hooks/useSessionId";
import { ACCEPTED_EXTENSIONS, useAttachments } from "../lib/attachments";
import type { Citation } from "../lib/consultTypes";
import type { Lawyer } from "../lib/demoLawyers";
import { getStarterQuestions, REFUSAL_HINT } from "../lib/starterQuestions";
import { CAPTION_JOINER } from "../lib/speech/fishSpeech";
import "./Meet.css"; // the room chrome shared with the live page: top bar, side panel, drawer / sheet
import "./Chat.css";

const PANEL_KEY = "chambersai.chatPanelOpen";
const PANEL_ID = "room-panel";
const MAX_FIELD_HEIGHT = 140;

function AdvocateHeadshot({ lawyer }: { lawyer: Lawyer }) {
  const { failed, onError } = useImageFallback();
  return (
    <span className="chat-turn__photo" aria-hidden="true">
      {failed ? <PlaceholderPortrait seed={lawyer.id} /> : <img src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt="" onError={onError} />}
    </span>
  );
}

export default function Chat() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const sessionId = useSessionId();
  const reduceMotion = useReducedMotion();

  const { lawyer, transcript, citations, handoff, notice, backendEnabled, addUserTurn, resolveLawyer, resolveAnswer, streamAnswer, cancelAnswer, addLawyerTurn } =
    useConsultationSession(id, sessionId);

  // ?q=<question> (from the profile page's sample questions) pre-fills the box once; it is never sent automatically.
  const [, setSearchParams] = useSearchParams();
  const [text, setText] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [typing, setTyping] = useState(false);
  // Backend mode: the answer being received, shown as it grows (text only; Chat has no audio). Recorded as the lawyer's turn once complete.
  const [streamText, setStreamText] = useState<string | null>(null);
  const [streamGeneral, setStreamGeneral] = useState(false); // the answer being received is general guidance (tagged, muted)
  const liveRef = useRef<{ text: string; citations: Citation[]; lawyer: Lawyer; outcome: AnswerOutcome } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const { panelOpen, overlayOpen, setOverlayOpen, toggle: togglePanel } = useRoomPanel(PANEL_KEY);
  const { files, error: attachError, addFiles, removeFile, atLimit } = useAttachments(sessionId, !typing);

  const threadRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stickRef = useRef(true); // the thread is at (or near) the bottom: new messages scroll into view
  const dockRef = useDockHeight();

  // Switching lawyer drops the answer in progress (the hook has already aborted the request).
  useEffect(
    () => () => {
      liveRef.current = null;
      setStreamText(null);
      setStreamGeneral(false);
      setTyping(false);
    },
    [id],
  );

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("q")) return;
    // After the session-id hook has written ?session= (same mount), so the two URL updates can't overwrite each other.
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      next.delete("q");
      setSearchParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(t);
  }, [setSearchParams]);

  const scrollToLatest = (smooth = true) => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  };

  // A new message (or the typing indicator) scrolls into view unless the reader has scrolled up; their own message always does.
  const lastRole = transcript[transcript.length - 1]?.role;
  useEffect(() => {
    if (stickRef.current || lastRole === "user") {
      stickRef.current = true;
      scrollToLatest();
    } else setShowJump(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript.length, typing, streamText]);

  const onThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickRef.current = nearBottom;
    setShowJump(!nearBottom);
  };

  // The field grows with its text, up to a few lines.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_FIELD_HEIGHT)}px`;
  }, [text, lawyer]);

  if (lawyer === undefined) return <div className="room room--chat room--loading" aria-busy="true" />;
  if (lawyer === null) {
    return (
      <div className="room room--chat room--empty">
        <p>This lawyer profile doesn't exist.</p>
      </div>
    );
  }

  // Records what has been received of the answer in progress as the lawyer's turn, and clears the live bubble.
  const recordLive = () => {
    const live = liveRef.current;
    liveRef.current = null;
    setStreamText(null);
    setStreamGeneral(false);
    setTyping(false);
    if (live?.text) addLawyerTurn(live.text, live.citations, live.lawyer, live.outcome);
  };

  const askBackend = (question: string) => {
    const answering = resolveLawyer(question);
    const live = { text: "", citations: [] as Citation[], lawyer: answering, outcome: {} as AnswerOutcome };
    liveRef.current = live;
    const end = (citations: Citation[], outcome: AnswerOutcome = {}) => {
      live.citations = citations;
      live.outcome = outcome;
      if (liveRef.current === live) recordLive();
    };
    streamAnswer(question, answering, {
      onSentence: ({ text: sentence, general }, citations) => {
        live.text = live.text ? `${live.text}${CAPTION_JOINER}${sentence}` : sentence;
        live.citations = citations;
        if (general) {
          live.outcome = { general: true }; // kept if the stream then fails before its end
          setStreamGeneral(true);
        }
        setTyping(false);
        setStreamText(live.text);
      },
      onRefused: (refusal, outcome) => {
        live.text = refusal; // exactly as the backend sent it; the hint and chips are added under it when it is shown
        end([], outcome);
      },
      onComplete: end,
      onFailure: end, // whatever arrived is kept; the hook shows the retry message
    });
  };

  const submit = (question: string) => {
    const trimmed = question.trim();
    // In demo mode a reply in progress blocks the box; with the backend, a new question cuts the answer off.
    if (!trimmed || (!backendEnabled && typing)) return;
    if (backendEnabled) {
      cancelAnswer();
      recordLive(); // keeps the part that was already received
    }
    addUserTurn(trimmed);
    setText("");
    setTyping(true);

    if (backendEnabled) {
      askBackend(trimmed);
      return;
    }

    window.setTimeout(() => {
      const { answeringLawyer, answer, citations: answerCitations } = resolveAnswer(trimmed);
      // A brief, length-proportional typing delay reads more like a real reply than an instant one.
      window.setTimeout(() => {
        addLawyerTurn(answer, answerCitations, answeringLawyer);
        setTyping(false);
      }, Math.min(1800, 400 + answer.length * 8));
    }, 400);
  };

  const handleSubmit = () => submit(text);

  const showStarters = transcript.length === 0 && !typing && streamText === null && getStarterQuestions(lawyer.id).length > 0;
  const canSend = text.trim().length > 0 && (backendEnabled || !typing);

  return (
    <div className={`room room--chat${panelOpen ? " room--panel-open" : ""}`}>
      <RoomTopBar
        name={lawyer.name}
        practice={lawyer.practice}
        panelOpen={panelOpen}
        panelId={PANEL_ID}
        panelNoun="sources and documents panel"
        onBack={() => navigate(`/lawyers/${lawyer.id}`)}
        switchLabel="Switch to live consultation"
        switchIcon={<Radio size={16} aria-hidden="true" />}
        onSwitch={() => navigate(`/consultation/meet/${lawyer.id}?session=${sessionId}`)}
        onTogglePanel={togglePanel}
      />

      <div className="chat-main">
        <div
          className="chat-thread"
          ref={threadRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={`Conversation with ${lawyer.name}`}
          tabIndex={0}
          onScroll={onThreadScroll}
        >
          <div className="chat-thread__inner">
            {transcript.length === 0 && !typing && streamText === null && <p className="chat-thread__empty">Ask {lawyer.name.replace(/^Adv\.?\s+/i, "").split(" ")[0]} a question to begin.</p>}
            {transcript.map((turn, i) => {
              const turnText = (t: typeof turn) => (
                <p className="chat-turn__text">
                  <span className="sr-only">{t.role === "user" ? "You: " : `${lawyer.name}: `}</span>
                  <PageTaggedText text={t.text} />
                </p>
              );
              const startsRun = transcript[i - 1]?.role !== turn.role;
              // Questions offered under a lawyer's intro or refusal, while it is the latest turn.
              const offer = i === transcript.length - 1 && turn.role === "lawyer" && turn.suggestions?.length ? turn : null;
              return (
                <Fragment key={turn.id}>
                  <div className={`chat-turn chat-turn--${turn.role}${startsRun ? " chat-turn--run-start" : ""}${showGeneralNotice(turn.general) ? " chat-turn--general" : ""}`}>
                    {turn.role === "lawyer" && (startsRun ? <AdvocateHeadshot lawyer={lawyer} /> : <span className="chat-turn__photo chat-turn__photo--spacer" aria-hidden="true" />)}
                    {showGeneralNotice(turn.general) ? (
                      <div className="chat-turn__content">
                        <GeneralTag />
                        {turnText(turn)}
                      </div>
                    ) : (
                      turnText(turn)
                    )}
                  </div>
                  {offer && (
                    <div className="chat-turn__offer">
                      <StarterChips questions={offer.suggestions} hint={offer.kind === "refusal" ? REFUSAL_HINT : undefined} className="room-starters--inline" onSelect={submit} />
                    </div>
                  )}
                </Fragment>
              );
            })}
            {streamText !== null && (
              <div className={`chat-turn chat-turn--lawyer${transcript[transcript.length - 1]?.role === "lawyer" ? "" : " chat-turn--run-start"}${showGeneralNotice(streamGeneral) ? " chat-turn--general" : ""}`}>
                {transcript[transcript.length - 1]?.role === "lawyer" ? (
                  <span className="chat-turn__photo chat-turn__photo--spacer" aria-hidden="true" />
                ) : (
                  <AdvocateHeadshot lawyer={lawyer} />
                )}
                {/* Hidden from screen readers while it grows; the recorded turn announces the whole answer once. */}
                {showGeneralNotice(streamGeneral) ? (
                  <div className="chat-turn__content" aria-hidden="true">
                    <GeneralTag />
                    <p className="chat-turn__text">
                      <PageTaggedText text={streamText} />
                    </p>
                  </div>
                ) : (
                  <p className="chat-turn__text" aria-hidden="true">
                    <PageTaggedText text={streamText} />
                  </p>
                )}
                <span className="sr-only" role="status">
                  {lawyer.name} is typing
                </span>
              </div>
            )}
            {typing && (
              <div className="chat-turn chat-turn--lawyer chat-turn--run-start" role="status">
                {transcript[transcript.length - 1]?.role === "lawyer" ? (
                  <span className="chat-turn__photo chat-turn__photo--spacer" aria-hidden="true" />
                ) : (
                  <AdvocateHeadshot lawyer={lawyer} />
                )}
                <div className="chat__typing" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="sr-only">{lawyer.name} is typing</span>
              </div>
            )}
          </div>
        </div>

        {handoff && (
          <div className="room__handoff">
            <HandoffBanner fromName={handoff.from} toName={handoff.to} />
          </div>
        )}

        <div className="chat-dock" ref={dockRef}>
          {showJump && (
            <button
              type="button"
              className="chat-jump"
              onClick={() => {
                stickRef.current = true;
                scrollToLatest();
              }}
            >
              <ArrowDown size={14} aria-hidden="true" />
              Jump to latest
            </button>
          )}
          {showStarters && <StarterChips lawyerId={lawyer.id} className="chat-starters" onSelect={submit} />}
          <DocumentBanner sessionId={sessionId} />
          <AttachmentChips files={files} onRemove={removeFile} />
          <div
            className={`chat-composer${dragOver ? " chat-composer--drag" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              multiple
              accept={ACCEPTED_EXTENSIONS.join(",")}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="chat-composer__icon-btn"
              aria-label="Attach documents"
              title="Documents are sent to our server and processed by Google Gemini to answer you."
              disabled={(typing && !backendEnabled) || atLimit}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <textarea
              ref={fieldRef}
              className="chat-composer__field"
              rows={1}
              aria-label="Message"
              placeholder="Type a message…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <button type="button" className="chat-composer__send" aria-label="Send" disabled={!canSend} onClick={handleSubmit}>
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          </div>
          {notice && (
            <p className="chat-composer__error" role="alert">
              {notice}
            </p>
          )}
          {attachError && (
            <p className="chat-composer__error" role="alert">
              {attachError}
            </p>
          )}
        </div>
      </div>

      {overlayOpen && <div className="room__scrim" onClick={() => setOverlayOpen(false)} aria-hidden="true" />}
      <div className="room__panel-slot">
        <RoomPanel
          id={PANEL_ID}
          transcript={transcript}
          liveCaption={null}
          citations={citations}
          files={files}
          tabKeys={["sources", "documents"]}
          onClose={() => setOverlayOpen(false)}
          expanded={overlayOpen}
          onToggleExpanded={(next) => setOverlayOpen((open) => next ?? !open)}
        />
      </div>
    </div>
  );
}
