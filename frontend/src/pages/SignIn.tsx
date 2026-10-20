import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

export default function SignIn() {
  const { authConfigured, signIn, signInWithGoogle, continueAsDemo } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/home";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Client-side UX only — not a real security control. Supabase and the backend must enforce
  // rate limiting server-side; see "Changes needed outside frontend/".
  const attemptsRef = useRef(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lockedUntil) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [lockedUntil]);

  const isLocked = Boolean(lockedUntil && now < lockedUntil);
  const secondsLeft = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      attemptsRef.current = 0;
      navigate(redirectTo, { replace: true });
    } catch (err) {
      attemptsRef.current += 1;
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setError(`Too many attempts. Try again in ${Math.ceil(LOCKOUT_MS / 1000)}s.`);
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  const handleDemo = () => {
    continueAsDemo();
    navigate("/home", { replace: true });
  };

  return (
    <AuthLayout>
      <h1>Log in</h1>
      <p className="auth-shell__subtitle">Welcome back.</p>

      {authConfigured ? (
        <>
          <form className="auth-form" onSubmit={handleSubmit}>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
            {error && (
              <p className="auth-error" role="alert">
                {isLocked ? `Too many attempts. Try again in ${secondsLeft}s.` : error}
              </p>
            )}
            <button type="submit" className="btn btn--primary" disabled={busy || isLocked}>
              {busy ? "Logging in…" : "Log in"}
            </button>
          </form>

          <div className="auth-links-row">
            <Link className="link-button" to="/forgot-password">
              Forgot password?
            </Link>
            <Link className="link-button" to="/signup">
              Need an account? Sign up
            </Link>
          </div>

          <p className="auth-divider">or</p>
          <button type="button" className="btn btn--outline" onClick={handleGoogle}>
            Continue with Google
          </button>
        </>
      ) : (
        <p className="auth-notice">Sign-in is not configured for this deployment. Continue with a sample account below.</p>
      )}

      <p className="auth-divider">or</p>
      <button type="button" className="btn btn--ghost" onClick={handleDemo}>
        Try a sample consultation
      </button>

      <p className="privacy-note">
        Your data is encrypted at rest and you can delete it anytime. (This does not claim
        end-to-end encryption — see Privacy & Settings for details.)
      </p>
    </AuthLayout>
  );
}
