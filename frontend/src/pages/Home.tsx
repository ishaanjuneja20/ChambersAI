import { useEffect, useState } from "react";
import LawyerCard from "../components/LawyerCard";
import VoiceButton from "../components/voice/VoiceButton";
import Decorations from "../components/Decorations";
import Reveal from "../components/Reveal";
import { getLawyers } from "../lib/lawyersApi";
import type { Lawyer } from "../lib/demoLawyers";
import { matchLawyer } from "../lib/matchApi";
import { useAuth } from "../context/AuthContext";
import "./Home.css";

export default function Home() {
  const { user } = useAuth();
  const [lawyers, setLawyers] = useState<Lawyer[]>([]);
  const [text, setText] = useState("");
  const [matching, setMatching] = useState(false);
  const [matched, setMatched] = useState<{ lawyerId: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLawyers().then(setLawyers);
  }, []);

  const handleSubmit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMatching(true);
    setError(null);
    try {
      const result = await matchLawyer(trimmed);
      setMatched(result);
    } catch {
      setError("Couldn't reach the matching service. Please try again, or pick a lawyer directly.");
    } finally {
      setMatching(false);
    }
  };

  const matchedLawyer = matched ? lawyers.find((l) => l.id === matched.lawyerId) : null;

  return (
    <div className="home-page">
      <Decorations />
      <div className="home-page__intro">
        <h1>{user?.isDemo ? "Welcome back" : "What's going on?"}</h1>
        <p>Describe your situation, or pick a lawyer below. We'll highlight a good match for you.</p>
      </div>

      <div className="describe-box">
        <textarea
          className="describe-box__input"
          rows={3}
          placeholder="e.g. My landlord won't return my security deposit after I moved out..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="describe-box__actions">
          <VoiceButton onResult={(result) => setText((prev) => (prev ? `${prev} ${result}` : result))} />
          <button type="button" className="btn btn--primary" onClick={handleSubmit} disabled={matching || !text.trim()}>
            {matching ? "Finding a match…" : "Find my lawyer"}
          </button>
        </div>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {matched && matchedLawyer && (
        <p className="match-banner">
          <strong>{matchedLawyer.name}</strong> looks like a good match — {matched.reason}
        </p>
      )}

      <div className="lawyer-grid">
        {lawyers.map((lawyer, i) => (
          <Reveal key={lawyer.id} delay={Math.min(i, 6) * 40}>
            <LawyerCard lawyer={lawyer} matched={matched?.lawyerId === lawyer.id} />
          </Reveal>
        ))}
      </div>
    </div>
  );
}
