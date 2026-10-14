import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import Avatar from "../components/Avatar";
import { getLawyers } from "../lib/api";
import type { LawyerEntry } from "../lib/contract";

interface NavState {
  lawyerId: string;
  reason: string;
  question: string;
  language: "en" | "hi";
}

export default function LawyerRecommendation() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as NavState | null;
  const [lawyers, setLawyers] = useState<LawyerEntry[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(state?.lawyerId);

  useEffect(() => {
    getLawyers().then(setLawyers);
  }, []);

  if (!state) {
    navigate("/home", { replace: true });
    return null;
  }

  const selected = lawyers.find((l) => l.id === selectedId) ?? lawyers.find((l) => l.id === state.lawyerId);

  const startConsultation = () => {
    navigate("/consultation", { state: { lawyerId: selected?.id ?? state.lawyerId, question: state.question, language: state.language } });
  };

  return (
    <AppShell>
      <div className="recommendation-page">
        {!selected ? (
          <p>Loading…</p>
        ) : (
          <div className="recommendation-card card">
            <Avatar lawyer={selected} size="small" />
            <div className="recommendation-card__body">
              <h2>{selected.name}</h2>
              <p className="recommendation-card__tagline">{(selected as any).tagline ?? selected.domain}</p>
              <p className="recommendation-card__languages">Speaks: {(selected as any).languages?.join(", ") ?? "en"}</p>
              <p className="recommendation-card__reason">{state.reason}</p>
              <div className="recommendation-card__actions">
                <button className="btn btn--primary" onClick={startConsultation}>
                  Start consultation
                </button>
                <button className="btn btn--outline" onClick={() => setShowAll((v) => !v)}>
                  Choose another lawyer
                </button>
              </div>
            </div>
          </div>
        )}

        {showAll && (
          <div className="lawyer-list">
            {lawyers.map((l) => (
              <button
                key={l.id}
                className={`lawyer-list__item${selectedId === l.id ? " lawyer-list__item--selected" : ""}`}
                onClick={() => {
                  setSelectedId(l.id);
                  setShowAll(false);
                }}
              >
                <Avatar lawyer={l} size="small" />
                <div>
                  <strong>{l.name}</strong>
                  <p>{(l as any).tagline ?? l.domain}</p>
                  <p className="lawyer-list__personality">{l.personality}</p>
                </div>
                <span className="btn btn--ghost btn--small" onClick={(e) => e.stopPropagation()}>
                  Hear voice
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
