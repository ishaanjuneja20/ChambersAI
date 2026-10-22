import { getStarterQuestions } from "../lib/starterQuestions";

// Suggested questions (styles: .room-starters in pages/Meet.css): the lawyer's own before the first message, or the ones that follow an
// intro or a refusal (`questions`, with a `hint` line above them). The caller decides when they show and what a tap does (send the
// question as if it had been typed).
export default function StarterChips({
  lawyerId,
  questions,
  hint,
  onSelect,
  className = "",
}: {
  lawyerId?: string;
  questions?: string[];
  hint?: string;
  onSelect: (question: string) => void;
  className?: string;
}) {
  const list = questions ?? getStarterQuestions(lawyerId);
  if (list.length === 0) return null;
  return (
    <div className={`room-starters ${className}`.trim()} role="group" aria-label="Suggested questions">
      {hint && <p className="room-starters__hint">{hint}</p>}
      {list.map((q) => (
        <button key={q} type="button" className="room-starter" title={q} onClick={() => onSelect(q)}>
          {q}
        </button>
      ))}
    </div>
  );
}
