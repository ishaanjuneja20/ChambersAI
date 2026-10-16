import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { deleteAllSessions } from "../lib/sessionsStore";
import Reveal from "../components/Reveal";
import Decorations from "../components/Decorations";
import "./Profile.css";
import "./Home.css";

type Lang = "en" | "hi";

export default function Profile() {
  const { user, authConfigured, signOut } = useAuth();
  const [lang, setLang] = useState<Lang>("en");
  const [deleted, setDeleted] = useState(false);

  const handleDeleteAccountData = () => {
    deleteAllSessions();
    setDeleted(true);
  };

  return (
    <div className="profile-page">
      <Decorations />
      <h1>Profile & Settings</h1>
      {user?.isDemo && <span className="home-placeholder__badge">Demo mode</span>}

      <Reveal as="section" className="profile-section card">
        <h2>Account</h2>
        <p>{user?.email}</p>
        {user?.isDemo && <p>Sample account — nothing here is saved beyond this browser.</p>}
      </Reveal>

      <Reveal as="section" className="profile-section card">
        <h2>Language</h2>
        <div className="language-toggle" role="radiogroup" aria-label="Preferred language">
          <button
            type="button"
            role="radio"
            aria-checked={lang === "en"}
            className={`language-toggle__option${lang === "en" ? " language-toggle__option--active" : ""}`}
            onClick={() => setLang("en")}
          >
            English
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={lang === "hi"}
            className={`language-toggle__option${lang === "hi" ? " language-toggle__option--active" : ""}`}
            onClick={() => setLang("hi")}
          >
            हिन्दी
          </button>
        </div>
        {lang === "hi" && <p>Hindi answers aren't available in this demo yet — questions will still be answered in English.</p>}
      </Reveal>

      <Reveal as="section" className="profile-section card">
        <h2>Voice settings</h2>
        <p>Each lawyer's voice is set by their persona on the backend; there's nothing to configure here yet.</p>
      </Reveal>

      <Reveal as="section" className="profile-section card">
        <h2>Privacy</h2>
        <ul>
          <li>Your conversations are encrypted at rest (AES-GCM).</li>
          <li>To generate answers and speech, your audio and text pass through Google Gemini and Fish Audio — this is not end-to-end encrypted.</li>
          <li>You can delete your data at any time below.</li>
        </ul>
      </Reveal>

      <Reveal as="section" className="profile-section card">
        <h2>Account actions</h2>
        <button type="button" className="btn btn--outline" onClick={handleDeleteAccountData}>
          Delete my account data
        </button>
        {deleted && (
          <p>
            Your consultation history has been deleted from this browser.
            {authConfigured && !user?.isDemo && " Permanently deleting your account itself requires a backend action — see below."}
          </p>
        )}
        {authConfigured && !user?.isDemo && (
          <p className="profile-section__danger-note">
            Full account deletion isn't available from this page yet — it requires a backend endpoint with
            service-role access, which the browser must never hold.
          </p>
        )}
        <button type="button" className="btn btn--outline" onClick={() => signOut()}>
          Log out
        </button>
      </Reveal>
    </div>
  );
}
