import { evaluatePasswordStrength } from "../lib/passwordStrength";

export default function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, level, label } = evaluatePasswordStrength(password);

  return (
    <div className="password-strength" aria-live="polite">
      <div className="password-strength__bar">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`password-strength__segment${i < score ? " password-strength__segment--filled" : ""}`}
            data-level={level}
          />
        ))}
      </div>
      <span className="password-strength__label">{label}</span>
    </div>
  );
}
