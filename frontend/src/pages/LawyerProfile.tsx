import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Info, MessageSquare, Mic, Pause, Volume2 } from "lucide-react";
import { getLawyers } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import { listSessions } from "../lib/sessionsStore";
import PlaceholderPortrait from "../components/PlaceholderPortrait";
import { useImageFallback } from "../hooks/useImageFallback";
import Decorations from "../components/Decorations";
import Reveal from "../components/Reveal";
import { prefetchLawyerModel } from "../components/avatar3d/modelPrefetch";
import "./LawyerProfile.css";

// Below this width of the page frame the layout is a single column with a fixed bottom action bar; above it the actions
// live in a sticky card in a right-hand column. (Must match the @container query in LawyerProfile.css.)
const WIDE_FROM = 880;

const firstName = (name: string) => name.replace(/^Adv\.?\s+/i, "").split(" ")[0];

// ---------------------------------------------------------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------------------------------------------------------

function Portrait({ lawyer, className }: { lawyer: Pick<Lawyer, "id" | "avatarUrl">; className: string }) {
  const { failed, onError } = useImageFallback();
  return failed ? <PlaceholderPortrait seed={lawyer.id} /> : <img className={className} src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt="" onError={onError} />;
}

// Plays the persona's sample clip, only on click (never autoplays) and stops when the page is left.
function HearVoiceButton({ url }: { url: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  const toggle = () => {
    if (!audio.current) {
      const el = new Audio(url);
      el.addEventListener("ended", () => setPlaying(false));
      el.addEventListener("pause", () => setPlaying(false));
      el.addEventListener("play", () => setPlaying(true));
      audio.current = el;
    }
    if (audio.current.paused) void audio.current.play().catch(() => setPlaying(false));
    else audio.current.pause();
  };

  return (
    <button type="button" className="lp-icon-btn" onClick={toggle} aria-pressed={playing} aria-label={playing ? "Pause voice sample" : "Hear voice sample"}>
      {playing ? <Pause size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
      <span className="lp-icon-btn__label">{playing ? "Pause" : "Hear voice"}</span>
    </button>
  );
}

function IconActions({ lawyer }: { lawyer: Lawyer }) {
  if (!lawyer.sampleAudioUrl) return null; // no sample clip, no row (no empty gap)
  return (
    <div className="lp-icon-actions">
      <HearVoiceButton url={lawyer.sampleAudioUrl} />
    </div>
  );
}

function ChipList({ items, label }: { items: string[]; label: string }) {
  return (
    <ul className="chip-list" aria-label={label}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------------------------------------------------

interface TabDef {
  key: string; // also the URL hash, so a tab can be linked
  label: string;
  panel: ReactNode;
}

function Tabs({ tabs }: { tabs: TabDef[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hash = location.hash.replace(/^#/, "");
  const active = Math.max(0, tabs.findIndex((t) => t.key === hash));

  const select = useCallback(
    (index: number, focus = false) => {
      navigate({ hash: tabs[index].key }, { replace: true });
      if (focus) refs.current[index]?.focus();
    },
    [navigate, tabs],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1;
    const next = { ArrowRight: active === last ? 0 : active + 1, ArrowLeft: active === 0 ? last : active - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next, true);
  };

  return (
    <section className="lp-tabs">
      <div className="lp-tabs__list" role="tablist" aria-label="About this advocate" onKeyDown={onKeyDown}>
        {tabs.map((tab, i) => (
          <button
            key={tab.key}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            id={`lp-tab-${tab.key}`}
            aria-selected={i === active}
            aria-controls={`lp-panel-${tab.key}`}
            tabIndex={i === active ? 0 : -1}
            className={`lp-tabs__tab${i === active ? " lp-tabs__tab--active" : ""}`}
            onClick={() => select(i)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div key={tab.key} role="tabpanel" id={`lp-panel-${tab.key}`} aria-labelledby={`lp-tab-${tab.key}`} hidden={i !== active} className="lp-tabs__panel" tabIndex={0}>
          {i === active && tab.panel}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// layout: wide (sticky side card) vs compact (fixed bottom bar)
// ---------------------------------------------------------------------------------------------------------------------

function useFrameLayout(ref: RefObject<HTMLElement>) {
  const [layout, setLayout] = useState({ wide: true, left: 0, width: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // The bar spans the main column only (the sidebar stays reachable), so measure the shell's main area.
      const main = document.querySelector(".shell__main")?.getBoundingClientRect();
      const next = { wide: el.getBoundingClientRect().width >= WIDE_FROM, left: Math.round(main?.left ?? 0), width: Math.round(main?.width ?? window.innerWidth) };
      setLayout((prev) => (prev.wide === next.wide && prev.left === next.left && prev.width === next.width ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref]);
  return layout;
}

// ---------------------------------------------------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------------------------------------------------

function ProfileView({ lawyer, others }: { lawyer: Lawyer; others: Lawyer[] }) {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLDivElement>(null);
  const { wide, left, width } = useFrameLayout(frameRef);
  const first = firstName(lawyer.name);

  const sessions = useMemo(() => listSessions().filter((s) => s.lawyerId === lawyer.id), [lawyer.id]);

  useEffect(() => {
    prefetchLawyerModel(lawyer.id); // the Meet button is one click away
  }, [lawyer.id]);

  // While the fixed bottom bar is on screen the floating "Find my lawyer" button moves up above it (see MatchAssistant.css).
  useEffect(() => {
    if (wide) return;
    document.body.classList.add("has-action-bar");
    return () => document.body.classList.remove("has-action-bar");
  }, [wide]);

  const startVoice = () => navigate(`/consultation/meet/${lawyer.id}`);
  const startChat = () => navigate(`/consultation/chat/${lawyer.id}`);
  const ask = (question: string) => navigate(`/consultation/chat/${lawyer.id}?q=${encodeURIComponent(question)}`);

  const hasStyle = !!(lawyer.personality || lawyer.voice || lawyer.look);
  const hasHelp = !!(lawyer.helpsWith?.length || lawyer.cannotHelpWith?.length);
  const questions = lawyer.sampleQuestions ?? [];

  const tabs: TabDef[] = [
    {
      key: "about",
      label: "About",
      panel: (
        <div className="lp-stack">
          <p className="lp-prose">{lawyer.description}</p>
          {lawyer.experience && (
            <div>
              <h3 className="lp-label">Background</h3>
              <p className="lp-prose">{lawyer.experience}</p>
            </div>
          )}
          {lawyer.specializations.length > 0 && (
            <div>
              <h3 className="lp-label">Specializations</h3>
              <ChipList items={lawyer.specializations} label="Specializations" />
            </div>
          )}
          {lawyer.languages.length > 0 && (
            <div>
              <h3 className="lp-label">Languages</h3>
              <ChipList items={lawyer.languages} label="Languages" />
            </div>
          )}
        </div>
      ),
    },
    ...(hasStyle
      ? [
          {
            key: "style",
            label: "Style & Voice",
            panel: (
              <div className="lp-facts-grid">
                {lawyer.personality && (
                  <div className="lp-fact lp-fact--wide">
                    <h3 className="lp-label">Personality</h3>
                    <p>{lawyer.personality}</p>
                  </div>
                )}
                {lawyer.voice && (
                  <div className="lp-fact">
                    <h3 className="lp-label">Voice</h3>
                    <p>{lawyer.voice}</p>
                  </div>
                )}
                {lawyer.look && (
                  <div className="lp-fact">
                    <h3 className="lp-label">Look</h3>
                    <p>{lawyer.look}</p>
                  </div>
                )}
              </div>
            ),
          },
        ]
      : []),
    ...(hasHelp
      ? [
          {
            key: "help",
            label: "What I can help with",
            panel: (
              <div className="lp-help">
                {!!lawyer.helpsWith?.length && (
                  <div className="lp-help__col">
                    <h3 className="lp-label">I can help with</h3>
                    <ul>
                      {lawyer.helpsWith.map((item) => (
                        <li key={item}>
                          <CheckCircle2 size={18} className="lp-help__icon lp-help__icon--yes" aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!lawyer.cannotHelpWith?.length && (
                  <div className="lp-help__col">
                    <h3 className="lp-label">I can't help with</h3>
                    <ul>
                      {lawyer.cannotHelpWith.map((item) => (
                        <li key={item}>
                          <Info size={18} className="lp-help__icon" aria-hidden="true" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ),
          },
        ]
      : []),
    ...(sessions.length
      ? [
          {
            key: "history",
            label: "Your history",
            panel: (
              <ul className="lp-history">
                {sessions.map((s) => (
                  <li key={s.id}>
                    <Link to={`/consultation/chat/${s.lawyerId}?session=${s.id}`} className="lp-history__link">
                      <span className="lp-history__title">{s.title}</span>
                      <span className="lp-history__date">{new Date(s.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                      <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ),
          },
        ]
      : []),
  ];

  const facts = [
    lawyer.languages.length ? { label: "Languages", value: lawyer.languages.join(", ") } : null,
    lawyer.specializations.length ? { label: "Specializations", value: String(lawyer.specializations.length) } : null,
    sessions.length ? { label: "Your consultations", value: `${sessions.length} with ${first}` } : null,
  ].filter((f): f is { label: string; value: string } => !!f);

  const actions = (
    <>
      <button type="button" className="btn btn--primary btn--lg lp-start" onClick={startVoice}>
        <Mic size={18} aria-hidden="true" />
        Start a live consultation
      </button>
      <button type="button" className="btn btn--outline btn--lg" onClick={startChat}>
        <MessageSquare size={18} aria-hidden="true" />
        Start a chat consultation
      </button>
    </>
  );

  return (
    <div className="lp">
      <Decorations />
      <div className={`lp__frame${wide ? " lp__frame--wide" : ""}`} ref={frameRef}>
        <div className="lp__top">
          <button type="button" className="lp-back" onClick={() => navigate("/home")}>
            <ArrowLeft size={18} aria-hidden="true" />
            Home
          </button>
        </div>

        <div className="lp__layout">
          <div className="lp__main">
            <header className="lp-hero">
              <div className="lp-portrait">
                <div className="lp-portrait__frame">
                  <Portrait lawyer={lawyer} className="lp-portrait__img" />
                </div>
              </div>
              <div className="lp-identity">
                <p className="lp-eyebrow">{lawyer.practice}</p>
                <h1>{lawyer.name}</h1>
                {!!lawyer.focusAreas?.length && <ChipList items={lawyer.focusAreas} label="Focus areas" />}
                <p className="lp-tagline">{lawyer.tagline}</p>
                {facts.length > 0 && (
                  <dl className="lp-quickfacts">
                    {facts.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {!wide && <IconActions lawyer={lawyer} />}
              </div>
            </header>

            {questions.length > 0 && (
              <Reveal as="section" className="lp-try">
                <h2 className="lp-h2">Try asking</h2>
                <ul className="lp-try__list">
                  {questions.map((q) => (
                    <li key={q}>
                      <button type="button" className="lp-question" onClick={() => ask(q)}>
                        <MessageSquare size={18} className="lp-question__icon" aria-hidden="true" />
                        <span>{q}</span>
                        <ArrowRight size={16} className="lp-question__go" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Reveal>
            )}

            <Reveal as="div">
              <Tabs tabs={tabs} />
            </Reveal>
          </div>

          {wide && (
            <aside className="lp__aside" aria-label="Start a consultation">
              <div className="lp-actions card">
                <p className="lp-actions__who">
                  <strong>{lawyer.name}</strong>
                  <span>{lawyer.practice}</span>
                </p>
                {actions}
                <IconActions lawyer={lawyer} />
              </div>
            </aside>
          )}
        </div>

        {others.length > 0 && (
          <Reveal as="section" className="lp-others">
            <h2 className="lp-h2">Other advocates</h2>
            <ul className="lp-others__list">
              {others.map((o) => (
                <li key={o.id}>
                  <Link to={`/lawyers/${o.id}`} className="lp-other" onPointerEnter={() => prefetchLawyerModel(o.id)}>
                    <span className="lp-other__img">
                      <Portrait lawyer={o} className="lp-other__photo" />
                    </span>
                    <span className="lp-other__name">{o.name}</span>
                    <span className="lp-other__practice">{o.practice}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        )}
      </div>

      {/* In a portal: the page and its fade-in animation use transforms, which would otherwise pin a fixed bar to the page, not the screen. */}
      {!wide &&
        createPortal(
          <div className="lp-bar" style={{ left, width }}>
            <button type="button" className="btn btn--primary lp-bar__main" onClick={startVoice}>
              <Mic size={18} aria-hidden="true" />
              Start a live consultation
            </button>
            <button type="button" className="btn btn--outline lp-bar__chat" onClick={startChat}>
              <MessageSquare size={18} aria-hidden="true" />
              Start a chat consultation
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="lp" aria-busy="true" aria-label="Loading advocate profile">
      <div className="lp__frame">
        <div className="lp__top">
          <div className="lp-skel lp-skel--pill" />
        </div>
        <div className="lp-hero">
          <div className="lp-portrait">
            <div className="lp-skel lp-skel--portrait" />
          </div>
          <div className="lp-identity">
            <div className="lp-skel lp-skel--line lp-skel--short" />
            <div className="lp-skel lp-skel--title" />
            <div className="lp-skel-row">
              <div className="lp-skel lp-skel--chip" />
              <div className="lp-skel lp-skel--chip" />
              <div className="lp-skel lp-skel--chip" />
            </div>
            <div className="lp-skel lp-skel--line" />
            <div className="lp-skel lp-skel--line lp-skel--short" />
            <div className="lp-skel lp-skel--button" />
          </div>
        </div>
        <div className="lp-skel lp-skel--block" />
      </div>
    </div>
  );
}

export default function LawyerProfile() {
  const { id = "" } = useParams();
  const [lawyers, setLawyers] = useState<Lawyer[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLawyers(undefined);
    getLawyers()
      .then((list) => !cancelled && setLawyers(list))
      .catch(() => !cancelled && setLawyers(null));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (lawyers === undefined) return <ProfileSkeleton />;

  const lawyer = lawyers?.find((l) => l.id === id);
  if (!lawyer) {
    return (
      <div className="lp">
        <div className="lp__frame">
          <div className="lp-missing">
            <h1>{lawyers ? "We couldn't find that advocate" : "We couldn't load this profile"}</h1>
            <p>{lawyers ? "This profile doesn't exist, or the link has changed." : "Please check your connection and try again."}</p>
            <Link to="/home" className="btn btn--primary">
              <ArrowLeft size={18} aria-hidden="true" />
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <ProfileView key={lawyer.id} lawyer={lawyer} others={lawyers!.filter((l) => l.id !== lawyer.id)} />;
}
