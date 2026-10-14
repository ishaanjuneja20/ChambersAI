import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../components/AppShell";
import VoiceOrTextInput from "../components/VoiceOrTextInput";
import { DEMO_LAWYERS } from "../lib/demoData";
import { matchLawyer } from "../lib/api";
import type { Lang } from "../lib/contract";

const DOMAINS = [
  { domain: "criminal", label: "Criminal" },
  { domain: "family", label: "Family" },
  { domain: "property", label: "Civil & Property" },
  { domain: "constitutional", label: "Constitutional" },
  { domain: "consumer", label: "Consumer" },
  { domain: "labour", label: "Employment" },
];

export default function Home() {
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>("en");
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (text: string) => {
    setMatching(true);
    setError(null);
    try {
      const result = await matchLawyer(text, lang);
      navigate("/recommendation", { state: { ...result, question: text, language: lang } });
    } catch {
      setError("Couldn't reach the matching service. Please try again.");
    } finally {
      setMatching(false);
    }
  };

  const handleDomainShortcut = (domain: string) => {
    const lawyer = DEMO_LAWYERS.find((l) => l.domain === domain);
    navigate("/recommendation", {
      state: { lawyerId: lawyer?.id ?? domain, reason: `You chose the ${domain} category directly.`, question: "", language: lang },
    });
  };

  return (
    <AppShell>
      <div className="home-page">
        <div className="home-page__intro">
          <h1>What's going on?</h1>
          <p>Describe your situation in your own words — by typing or speaking. We'll match you with the right AI lawyer.</p>
          <div className="language-toggle" role="radiogroup" aria-label="Language">
            <button role="radio" aria-checked={lang === "en"} className={`language-toggle__option${lang === "en" ? " language-toggle__option--active" : ""}`} onClick={() => setLang("en")}>
              English
            </button>
            <button role="radio" aria-checked={lang === "hi"} className={`language-toggle__option${lang === "hi" ? " language-toggle__option--active" : ""}`} onClick={() => setLang("hi")}>
              हिन्दी
            </button>
          </div>
        </div>

        <div className="home-page__input card">
          <VoiceOrTextInput
            lang={lang}
            placeholder="e.g. My landlord won't return my security deposit after I moved out..."
            onSubmit={handleSubmit}
            disabled={matching}
            submitLabel={matching ? "Matching…" : "Find my lawyer"}
          />
          {error && <p className="auth-form__error" role="alert">{error}</p>}
          <button type="button" className="btn btn--outline home-page__upload" onClick={() => navigate("/documents")}>
            Upload a document instead
            <span className="badge badge--demo-mini">demo</span>
          </button>
        </div>

        <div className="home-page__domains">
          <p className="home-page__domains-label">Or jump straight to a specialization:</p>
          <div className="domain-grid">
            {DOMAINS.map((d) => (
              <button key={d.domain} type="button" className="domain-chip" onClick={() => handleDomainShortcut(d.domain)}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
