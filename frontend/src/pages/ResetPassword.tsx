import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import PasswordStrengthMeter from "../components/PasswordStrengthMeter";
import { useAuth } from "../context/AuthContext";
import { evaluatePasswordStrength } from "../lib/passwordStrength";

// Reached via the link from ForgotPassword's email. Supabase (detectSessionInUrl: true)
// establishes a temporary recovery session from the URL before this page's form is submitted.
export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const strength = evaluatePasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (strength.score === 0) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      window.setTimeout(() => navigate("/home", { replace: true }), 1500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "This reset link may have expired. Request a new one from the forgot-password page.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthLayout>
        <h1>Password updated</h1>
        <p className="auth-notice">Taking you to ChambersAI…</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Choose a new password</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          New password
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
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
      <Link className="link-button" to="/login">
        Back to log in
      </Link>
    </AuthLayout>
  );
}
