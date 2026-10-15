import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Volume2 } from "lucide-react";
import { getLawyer } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import PlaceholderPortrait from "../components/PlaceholderPortrait";
import { useImageFallback } from "../hooks/useImageFallback";
import PagePlaceholder from "../components/PagePlaceholder";
import "./LawyerProfile.css";

export default function LawyerProfile() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [lawyer, setLawyer] = useState<Lawyer | null | undefined>(undefined);
  const { failed, onError } = useImageFallback();

  useEffect(() => {
    let cancelled = false;
    getLawyer(id).then((result) => {
      if (!cancelled) setLawyer(result ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (lawyer === undefined) {
    return <PagePlaceholder title="Loading…" note="" />;
  }
  if (lawyer === null) {
    return <PagePlaceholder title="Lawyer not found" note="This profile doesn't exist." />;
  }

  const handleHearVoice = () => {
    if (!lawyer.sampleAudioUrl) return;
    new Audio(lawyer.sampleAudioUrl).play().catch(() => {
      /* ignore: sample not playable in this browser/deployment */
    });
  };

  return (
    <div className="lawyer-profile">
      <div className="lawyer-profile__header">
        <div className="lawyer-profile__portrait">
          {failed ? (
            <PlaceholderPortrait seed={lawyer.id} />
          ) : (
            <img src={lawyer.avatarUrl ?? `/lawyers/${lawyer.id}.jpg`} alt="" onError={onError} />
          )}
        </div>

        <div className="lawyer-profile__identity">
          <h1>{lawyer.name}</h1>
          <p className="lawyer-profile__type">{lawyer.practice} advocate persona</p>
          <p>{lawyer.tagline}</p>

          <button
            type="button"
            className="btn btn--outline lawyer-profile__hear-voice"
            onClick={handleHearVoice}
            disabled={!lawyer.sampleAudioUrl}
            title={lawyer.sampleAudioUrl ? "Play a voice sample" : "Voice sample not available in demo mode"}
          >
            <Volume2 size={16} style={{ marginRight: 6, verticalAlign: "-3px" }} />
            Hear voice
          </button>
        </div>

        <div className="lawyer-profile__cta">
          <button type="button" className="btn btn--primary btn--lg" onClick={() => navigate(`/consultation/meet/${lawyer.id}`)}>
            Meet
          </button>
          <button type="button" className="btn btn--outline btn--lg" onClick={() => navigate(`/consultation/chat/${lawyer.id}`)}>
            Chat
          </button>
        </div>
      </div>

      <p className="lawyer-profile__persona-label">AI advocate persona. Not a real person or a licensed advocate.</p>

      <div className="lawyer-profile__section">
        <h2>About</h2>
        <p>{lawyer.description}</p>
      </div>

      <div className="lawyer-profile__section">
        <h2>Experience</h2>
        <p>{lawyer.experience}</p>
      </div>

      <div className="lawyer-profile__section">
        <h2>Specializations</h2>
        <ul className="chip-list">
          {lawyer.specializations.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>

      <div className="lawyer-profile__section">
        <h2>Languages</h2>
        <ul className="chip-list">
          {lawyer.languages.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
