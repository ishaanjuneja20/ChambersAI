import { useState } from "react";
import AppShell from "../components/AppShell";
import { useAuth } from "../context/AuthContext";
import { deleteAllSessions } from "../lib/sessionsStore";
import type { Lang } from "../lib/contract";

export default function Profile() {
  const { user } = useAuth();
  const [lang, setLang] = useState<Lang>("en");
  const [deleted, setDeleted] = useState(false);

  return (
    <AppShell>
      <div className="profile-page">
        <h1>Profile & settings</h1>

        <section className="card">
          <h2>Account</h2>
          <p>Email: {user?.email}</p>
          {user?.isDemo && <p className="badge badge--demo">Sample account — nothing here is saved beyond this browser</p>}
        </section>

        <section className="card">
          <h2>Language preference</h2>
          <div className="language-toggle" role="radiogroup" aria-label="Preferred language">
            <button role="radio" aria-checked={lang === "en"} className={`language-toggle__option${lang === "en" ? " language-toggle__option--active" : ""}`} onClick={() => setLang("en")}>
              English
            </button>
            <button role="radio" aria-checked={lang === "hi"} className={`language-toggle__option${lang === "hi" ? " language-toggle__option--active" : ""}`} onClick={() => setLang("hi")}>
              हिन्दी
            </button>
          </div>
          {lang === "hi" && <p className="case-panel__demo-note">Hindi is not available in this demo — questions will still be answered in English.</p>}
        </section>

        <section className="card">
          <h2>Voice settings</h2>
          <p className="case-panel__demo-note">Voice selection per lawyer is set by the backend; no changes are available here yet.</p>
        </section>

        <section className="card">
          <h2>Privacy and data</h2>
          <ul className="privacy-list">
            <li>Your conversations are encrypted at rest (AES-GCM).</li>
            <li>To generate answers and speech, your questions pass through Google Gemini and Fish Audio — this is not end-to-end encrypted.</li>
            <li>Uploaded documents (demo feature) are stored only for this session and are not yet reviewed by a human.</li>
            <li>You can delete your conversation history at any time below.</li>
          </ul>
          <button
            className="btn btn--outline"
            onClick={() => {
              deleteAllSessions();
              setDeleted(true);
            }}
          >
            Delete all my conversations
          </button>
          {deleted && <p className="case-panel__empty">All conversations deleted from this browser.</p>}
        </section>
      </div>
    </AppShell>
  );
}
