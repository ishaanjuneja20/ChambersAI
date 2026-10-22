// Suggested questions shown as tappable chips in the empty state of the Meet and Chat screens, keyed by lawyer id.
// A lawyer without an entry shows no chips.
export const STARTER_QUESTIONS: Record<string, string[]> = {
  criminal: [
    "The police are refusing to register my FIR. What should I do?",
    "I was arrested for a bailable offence. Can I get bail?",
    "Someone stole my phone. What is the punishment for this?",
  ],
  family: [
    "My husband beats me. What protection can I get from the law?",
    "How can we get a divorce if both of us agree?",
    "Does a daughter get a share in her father's property?",
  ],
  property: [
    "My landlord wants to throw me out without giving any notice. Is that allowed?",
    "Is it compulsory to register the sale of my house?",
    "The builder gave me possession of my flat two years late. What can I do?",
  ],
  labour: [
    "My employer fired me without any notice. What can I do?",
    "I was sexually harassed at my workplace. Where do I complain?",
    "When do I get my gratuity after leaving my job?",
  ],
  consumer: ["I bought a defective phone and the shop will not refund my money. What should I do?"],
  constitutional: [
    "I asked a government office for information under RTI but they are not replying. What now?",
    "The police arrested me but did not tell me the reason. Is that legal?",
  ],
};

export function getStarterQuestions(lawyerId: string | undefined): string[] {
  return (lawyerId && STARTER_QUESTIONS[lawyerId]) || [];
}

/** The line above the suggested questions that follow a refusal. */
export const REFUSAL_HINT = "Try asking about a specific situation, for example:";
/** How many of the lawyer's questions follow a refusal. */
export const REFUSAL_SUGGESTIONS = 3;
