import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteAllSessions, deleteSession, listSessions, type ConsultationSession } from "../lib/sessionsStore";
import Reveal from "../components/Reveal";
import Decorations from "../components/Decorations";
import "./MyConsultations.css";

export default function MyConsultations() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  const filtered = sessions.filter((s) => `${s.title} ${s.domain} ${s.lawyerName}`.toLowerCase().includes(query.toLowerCase()));

  const handleDelete = (id: string) => {
    deleteSession(id);
    setSessions(listSessions());
  };

  const handleDeleteAll = () => {
    deleteAllSessions();
    setSessions([]);
  };

  const handleReopen = (session: ConsultationSession) => {
    navigate(`/consultation/chat/${session.lawyerId}?session=${session.id}`);
  };

  return (
    <div className="consultations-page">
      <Decorations />
      <div className="consultations-page__header">
        <h1>My Consultations</h1>
        {sessions.length > 0 && (
          <button type="button" className="btn btn--outline" onClick={handleDeleteAll}>
            Delete all
          </button>
        )}
      </div>

      <input
        className="consultations-page__search"
        placeholder="Search consultations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <p className="empty-note">{sessions.length === 0 ? 'No consultations yet. Start one from "New Consultation".' : "No matches."}</p>
      ) : (
        <ul className="session-list">
          {filtered.map((s, i) => (
            <Reveal as="li" key={s.id} className="session-list__item card" delay={Math.min(i, 6) * 40}>
              <div>
                <strong>{s.title}</strong>
                <p className="session-list__meta">
                  {s.lawyerName} · {s.domain} · {new Date(s.updatedAt).toLocaleDateString()}
                </p>
                <p className="session-list__last">{s.transcript[s.transcript.length - 1]?.text.slice(0, 90) ?? ""}</p>
              </div>
              <div className="session-list__actions">
                <button type="button" className="btn btn--primary" onClick={() => handleReopen(s)}>
                  Reopen
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => handleDelete(s.id)}>
                  Delete
                </button>
              </div>
            </Reveal>
          ))}
        </ul>
      )}
    </div>
  );
}
