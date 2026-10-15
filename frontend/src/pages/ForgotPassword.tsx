import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/AuthLayout";
import { useAuth } from "../context/AuthContext";

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await requestPasswordReset(email);
    } catch {
      // Intentionally swallowed: the confirmation message below never reveals whether the
      // address is registered, so a failed send looks identical to a successful one.
    } finally {
      setBusy(false);
      setSent(true);
    }
  };

  if (sent) {
    return (
      <AuthLayout>
        <h1>Check your email</h1>
        <p className="auth-notice">If an account exists for that email, we've sent a password reset link.</p>
        <Link className="link-button" to="/login">
          Back to log in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1>Reset your password</h1>
      <p className="auth-shell__subtitle">We'll email you a link to choose a new one.</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <Link className="link-button" to="/login">
        Back to log in
      </Link>
    </AuthLayout>
  );
}
