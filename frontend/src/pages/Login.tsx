import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { signInWithEmail, signUpWithEmail, signInWithGoogle } from "../lib/auth";

export default function Login() {
  const { authConfigured, continueAsDemo, refresh } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = mode === "signin" ? await signInWithEmail(email, password) : await signUpWithEmail(email, password);
      if (error) throw error;
      await refresh();
      navigate("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const handleDemo = () => {
    continueAsDemo();
    navigate("/home");
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>ChambersAI</h1>
        </div>
        <p className="auth-card__intro">
          Talk through your legal question with an AI lawyer matched to your situation, backed by real statutes and
          judgments. General information to help you understand your options — not a replacement for an advocate.
        </p>

        {authConfigured ? (
          <>
            <form className="auth-form" onSubmit={handleSubmit}>
              <label>
                Email
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </label>
              <label>
                Password
                <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={6} />
              </label>
              {error && <p className="auth-form__error" role="alert">{error}</p>}
              <button type="submit" className="btn btn--primary" disabled={busy}>
                {mode === "signin" ? "Log in" : "Sign up"}
              </button>
            </form>
            <button type="button" className="btn btn--outline" onClick={() => signInWithGoogle()}>
              Continue with Google
            </button>
            <button type="button" className="link-button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
              {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Log in"}
            </button>
          </>
        ) : (
          <p className="auth-card__notice">Sign-in is not configured for this deployment. Continue with a sample account below.</p>
        )}

        <div className="auth-card__divider">or</div>
        <button type="button" className="btn btn--ghost" onClick={handleDemo}>
          Try a sample consultation
        </button>
      </div>
    </div>
  );
}
