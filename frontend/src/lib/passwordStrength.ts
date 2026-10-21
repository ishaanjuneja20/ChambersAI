// Local heuristic only — no external library. Good enough to steer users toward a stronger
// password; Supabase itself enforces the real minimum length server-side.
export type StrengthLevel = "too-short" | "weak" | "fair" | "good" | "strong";

export interface PasswordStrength {
  score: number; // 0-4
  level: StrengthLevel;
  label: string;
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length < 8) {
    return { score: 0, level: "too-short", label: "At least 8 characters" };
  }

  let score = 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  if (password.length >= 12) score++;
  score = Math.min(score, 4);

  const levels: { level: StrengthLevel; label: string }[] = [
    { level: "weak", label: "Weak" },
    { level: "weak", label: "Weak" },
    { level: "fair", label: "Fair" },
    { level: "good", label: "Good" },
    { level: "strong", label: "Strong" },
  ];
  return { score, ...levels[score] };
}
