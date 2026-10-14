import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import { listSessions, deleteSession, deleteAllSessions, getSession } from "../lib/sessionsStore";
import type { SessionSummaryItem } from "../lib/contract";

export default function MyConsultations() {
  const [sessions, setSessions] = useState<SessionSummaryItem[]>([]);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

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

  const handleReopen = (id: string) => {
    const full = getSession(id);
    if (!full) return;
    navigate("/consultation", { state: { lawyerId: full.lawyerId, question: "", language: "en", sessionId: full.id } });
  };

  return (
    <AppShell>
      <div className="consultations-page">
        <div className="consultations-page__header">
          <h1>My consultations</h1>
          {sessions.length > 0 && (
            <button className="btn btn--outline btn--small" onClick={handleDeleteAll}>
              Delete all
            </button>
          )}
        </div>
        <input className="consultations-page__search" placeholder="Search consultations…" value={query} onChange={(e) => setQuery(e.target.value)} />

        {filtered.length === 0 ? (
          <p className="case-panel__empty">No consultations yet. Start one from "New consultation".</p>
        ) : (
          <ul className="session-list">
            {filtered.map((s) => (
              <li key={s.id} className="session-list__item card">
                <div>
                  <strong>{s.title}</strong>
                  <p className="session-list__meta">{s.lawyerName} · {s.domain} · {new Date(s.createdAt).toLocaleDateString()}</p>
                  <p className="session-list__last">{s.lastMessage}</p>
                </div>
                <div className="session-list__actions">
                  <button className="btn btn--primary btn--small" onClick={() => handleReopen(s.id)}>
                    Reopen
                  </button>
                  <button className="btn btn--ghost btn--small" onClick={() => handleDelete(s.id)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
