import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import PasswordStrengthMeter from "../components/PasswordStrengthMeter";
import { useAuth } from "../context/AuthContext";
import { evaluatePasswordStrength } from "../lib/passwordStrength";

export default function SignUp() {
  const { authConfigured, signUp, continueAsDemo } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const strength = evaluatePasswordStrength(password);
  const passwordOk = strength.score > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await signUp(name.trim(), email, password);
      if (result.needsEmailVerification) {
        setVerificationSent(true);
      } else {
        navigate("/home", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (verificationSent) {
    return (
      <AuthLayout>
        <h1>Check your email</h1>
        <p className="auth-notice">
          We've sent a verification link to <strong>{email}</strong>. Verify your address before
          logging in for the first time.
        </p>
        <Link className="link-button" to="/login">
          Back to log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Sign up</h1>
      <p className="auth-shell__subtitle">Create an account to save your consultations.</p>

      {authConfigured ? (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Name
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <PasswordStrengthMeter password={password} />
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Creating account…" : "Sign up"}
          </button>
        </form>
      ) : (
        <p className="auth-notice">Sign-up is not configured for this deployment. Continue with a sample account below.</p>
      )}

      <div className="auth-links-row">
        <Link className="link-button" to="/login">
          Already have an account? Log in
        </Link>
      </div>

      <p className="auth-divider">or</p>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => {
          continueAsDemo();
          navigate("/home", { replace: true });
        }}
      >
        Try a sample consultation
      </button>

      <p className="privacy-note">Your data is encrypted at rest and you can delete it anytime.</p>
    </AuthLayout>
  );
}
