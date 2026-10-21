import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Avatar from "../components/Avatar";
import { getLawyerModel } from "../components/avatar3d/lawyerModels";
import HandoffBanner from "../components/HandoffBanner";
import MeetInputBar from "../components/MeetInputBar";
import AvatarLoadOverlay from "../components/meet/AvatarLoadOverlay";
import RoomPanel from "../components/meet/RoomPanel";
import RoomTopBar from "../components/meet/RoomTopBar";
import Subtitles, { type LiveCaption } from "../components/meet/Subtitles";
import { type VoiceButtonHandle } from "../components/voice/VoiceButton";
import { useSessionFiles } from "../lib/attachments";
import type { ConsultStatus } from "../lib/consultTypes";
import { useConsultationSession } from "../hooks/useConsultationSession";
import { useDockHeight } from "../hooks/useDockHeight";
import { useRoomPanel } from "../hooks/useRoomPanel";
import { useSessionId } from "../hooks/useSessionId";
import { useSpeak } from "../hooks/useSpeak";
import { useSyntheticSpeechLevel } from "../hooks/useSyntheticSpeechLevel";
import "./Meet.css";

// The stage never re-renders per caption word: its props are all stable or primitive.
const StageAvatar = memo(Avatar);

const STATUS_ANNOUNCEMENT: Record<ConsultStatus, string> = {
  idle: "Idle",
  listening: "Listening",
  processing: "Processing",
  speaking: "Speaking",
};

const PANEL_KEY = "chambersai.meetPanelOpen";
const PANEL_ID = "room-panel";
const DEFAULT_STAGE_BG = `${import.meta.env.BASE_URL}assets/courtroom-background.png`;

export default function Meet() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const sessionId = useSessionId();
  const files = useSessionFiles(sessionId); // shared with the Chat page

  const { lawyer, transcript, citations, handoff, addUserTurn, resolveAnswer, addLawyerTurn } = useConsultationSession(id, sessionId);

  const [status, setStatus] = useState<ConsultStatus>("idle");
  const [liveCaption, setLiveCaption] = useState<LiveCaption | null>(null);
  // ?q=<question> (from the profile page's sample questions) pre-fills the box once; it is never sent automatically.
  const [, setSearchParams] = useSearchParams();
  const [text, setText] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [avatarSettled, setAvatarSettled] = useState(false); // the 3D scene rendered its first frame, or fell back to the 2D portrait
  const onAvatarSettled = useCallback(() => setAvatarSettled(true), []);
  const [stageRevealed, setStageRevealed] = useState(false); // the loader is leaving: the courtroom backdrop around the video box may show now
  const onLoaderLeaving = useCallback(() => setStageRevealed(true), []);
  const [usedInput, setUsedInput] = useState(false); // hides the "Hold Space to talk" hint once voice or typing has been used

  // Side panel: remembered open / closed on desktop; a drawer (tablet) or bottom sheet (phone) elsewhere.
  const { panelOpen, overlayOpen, setOverlayOpen, toggle: togglePanel } = useRoomPanel(PANEL_KEY);

  const voiceButtonRef = useRef<VoiceButtonHandle>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const dockRef = useDockHeight();
  const { speak, stop: stopSpeaking, supported: speechSupported, lipSync } = useSpeak();
  // 3D lawyers are driven by `lipSync` inside their render loop; the per-frame synthetic level (React
  // state) is only needed by the 2D portraits.
  const has3D = !!lawyer && !!getLawyerModel(lawyer.id);
  const audioLevel = useSyntheticSpeechLevel(status === "speaking" && !has3D);

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

  // The page shell, the stage box and its black logo loader are all there from the first render, using the id from the route; the real lawyer
  // swaps in when the data arrives. (Before that, `routeModel` decides whether this is going to be a 3D stage.)
  const routeModel = getLawyerModel(id);
  const lawyerModel = lawyer ? getLawyerModel(lawyer.id) : undefined;
  const loaderVisible = lawyer === undefined ? !!routeModel : !!lawyerModel;
  const stageModel = lawyer === undefined ? routeModel : lawyerModel;

  // Fetch the courtroom picture now, so it is in the cache (and decoded) by the time the avatar reveals it.
  useEffect(() => {
    if (!routeModel) return;
    const img = new Image();
    img.src = routeModel.backgroundUrl;
  }, [routeModel]);

  if (lawyer === null) {
    return (
      <div className="room room--empty">
        <p>This lawyer profile doesn't exist.</p>
      </div>
    );
  }

  async function submitQuestion(question: string) {
    const trimmed = question.trim();
    if (!trimmed) return;
    setUsedInput(true);
    addUserTurn(trimmed);
    setStatus("processing");
    setText("");

    window.setTimeout(() => {
      const { answeringLawyer, answer, citations: answerCitations } = resolveAnswer(trimmed);
      setStatus("speaking");
      setLiveCaption({ text: answer, visibleChars: 0 });
      speak(
        answer,
        (charIndex) => setLiveCaption((prev) => (prev ? { ...prev, visibleChars: charIndex } : prev)),
        () => {
          setLiveCaption(null);
          addLawyerTurn(answer, answerCitations, answeringLawyer);
          setStatus("idle");
        },
        { lawyerId: answeringLawyer.id },
      );
    }, 500);
  }

  const handleStop = () => {
    stopSpeaking();
    voiceButtonRef.current?.cancel();
    setLiveCaption(null);
    setStatus("idle");
  };

  const handleTextSubmit = () => {
    if (status !== "idle" || !lawyer) return;
    void submitQuestion(text);
  };

  const starters = (lawyer?.sampleQuestions ?? []).slice(0, 4);
  const showStarters = starters.length > 0 && transcript.length === 0 && (status === "idle" || status === "listening");
  const stageBg = stageModel?.backgroundUrl ?? DEFAULT_STAGE_BG;

  return (
    <>
      <div className={`room${panelOpen ? " room--panel-open" : ""}`}>
        {/* The state is shown by the stage's glow and the input bar; this announces it to screen readers. */}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {STATUS_ANNOUNCEMENT[status]}
        </p>
        <RoomTopBar
          name={lawyer?.name ?? "\u00A0"}
          practice={lawyer?.practice ?? "\u00A0"}
          panelOpen={panelOpen}
          panelId={PANEL_ID}
          onBack={() => navigate(`/lawyers/${lawyer?.id ?? id}`)}
          onSwitch={() => navigate(`/consultation/chat/${lawyer?.id ?? id}?session=${sessionId}`)}
          onTogglePanel={togglePanel}
        />

        <div className={`room__stage${stageRevealed || !loaderVisible ? "" : " room__stage--pending"}`} style={{ "--stage-bg": `url("${stageBg}")` } as React.CSSProperties}>
          <div className={`room__frame${lawyer && !lawyerModel ? " room__frame--static" : ""}`}>
            {lawyer && <StageAvatar lawyer={lawyer} status={status} audioLevel={audioLevel} size="large" lipSync={lipSync} onReady={onAvatarSettled} onModelFailed={onAvatarSettled} />}
            {loaderVisible && <AvatarLoadOverlay waiting={!avatarSettled} onLeaving={onLoaderLeaving} />}
            {handoff && (
              <div className="room__handoff">
                <HandoffBanner fromName={handoff.from} toName={handoff.to} />
              </div>
            )}
            <Subtitles caption={liveCaption} />
          </div>
        </div>

        <div className="room__dock" ref={dockRef}>
          {!speechSupported && <p className="meet__disclaimer">(Voice playback isn't supported in this browser — captions still work.)</p>}
          {showStarters && (
            <div className="room-starters" role="group" aria-label="Suggested questions">
              {starters.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="room-starter"
                  onClick={() => {
                    setText(q);
                    fieldRef.current?.focus();
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <MeetInputBar
            sessionId={sessionId}
            text={text}
            onTextChange={(value) => {
              setText(value);
              if (value) setUsedInput(true);
            }}
            onSubmit={handleTextSubmit}
            onStop={handleStop}
            status={status}
            onVoiceResult={(result) => void submitQuestion(result)}
            onListeningChange={(isListening) => {
              if (isListening) setUsedInput(true);
              setStatus(isListening ? "listening" : "idle");
            }}
            voiceDisabled={status !== "idle" && status !== "listening"}
            voiceButtonRef={voiceButtonRef}
            fieldRef={fieldRef}
          />
          {!usedInput && (
            <p className="room-hint">
              Hold <kbd>Space</kbd> to talk
            </p>
          )}
        </div>

        {overlayOpen && <div className="room__scrim" onClick={() => setOverlayOpen(false)} aria-hidden="true" />}
        <div className="room__panel-slot">
          <RoomPanel
            id={PANEL_ID}
            transcript={transcript}
            liveCaption={liveCaption}
            citations={citations}
            files={files}
            onClose={() => setOverlayOpen(false)}
            expanded={overlayOpen}
            onToggleExpanded={(next) => setOverlayOpen((open) => next ?? !open)}
          />
        </div>
      </div>
    </>
  );
}
