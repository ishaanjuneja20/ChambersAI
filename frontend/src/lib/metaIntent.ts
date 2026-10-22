// Messages that are not legal questions: greetings and "what can you do / what should I ask" requests. They are answered in the
// app with a short fixed intro (never by the backend, never with a citation), followed by the lawyer's suggested questions.
// English and Hindi (Devanagari and romanised) at a basic level.
//
// How a message is judged (detectMetaIntent):
//   1. It is normalised: lower case, "what's" -> "what is", chat spellings ("u", "r"), punctuation gone, spaces collapsed.
//   2. More than MAX_WORDS words, or any legal content word (police, bail, landlord, section ...): not meta, whatever else it says.
//      "Can you help me understand if my landlord can evict me without notice?" is a legal question that happens to contain "help".
//   3. Greetings and filler ("hello there", "ok so", "please", "sir") are taken off both ends; what is left must match one INTENT
//      pattern as a whole ("what can you help me with", "how can you help", "what should I ask" ...), so a longer, unrelated sentence
//      that merely starts like one still goes to the backend.
//   4. The message may be several such parts in a row ("hello, who are you and what can you do", "thanks, bye", "I have a question, what
//      is your name"): it is cut into consecutive parts and is meta only when EVERY part is one. So the phrase can sit anywhere in a short
//      message, but "who are you and can my landlord evict me" (a part that is not meta) still goes to the backend.
import type { Lawyer } from "./demoLawyers";
import { detectLang } from "./lipsync/g2p";
import { getStarterQuestions } from "./starterQuestions";

/** greeting: "hello"; help: who/what are you, what can you do ...; thanks: "thank you"; bye: "goodbye". */
export type MetaIntent = "greeting" | "help" | "thanks" | "bye";

/** A message with more words than this is treated as a real question. */
export const MAX_WORDS = 12;

// ---- Edit the vocabulary here.

/** One-word greetings (matched as whole words). */
const GREETING_WORDS = [/^h+i+$/, /^he+y+$/, /^hell+o+$/, /^hallo$/, /^hullo$/, /^heya?$/, /^hiya$/, /^yo$/, /^hola$/, /^howdy$/, /^namaste$/, /^namaskar$/, /^namaskaram$/, /^namastey$/, /^pranam$/, /^salaam$/, /^salam$/, /^suprabhat$/, /^greetings$/, "नमस्ते", "नमस्कार", "प्रणाम", "हैलो", "हेलो", "हलो", "हाय", "सुप्रभात"];
/** Words that may sit around a greeting ("hello there", "hi sir", "namaste ji") or trail a request ("help me please", "what can you do today"). */
const FILLER_WORDS = [
  "there", "sir", "madam", "maam", "ma", "am", "ji", "advocate", "adv", "counsel", "lawyer", "everyone", "all", "please", "pls", "plz", "kindly", "dear", "bhai", "bro", "buddy", "friend",
  "today", "now", "here", "then", "exactly", "again", "too", "also", "bhi", "yaar", "जी", "सर", "मैडम", "साहब", "वकील", "भाई",
];
/** Taken off the front of what is left: hesitations and lead-ins ("ok so", "tell me what ..."). */
const LEAD_IN = /^(?:(?:ok|okay|so|well|um|uh|hmm|actually|just|and|also|then|acha|accha|bas|great|awesome|perfect|cool|nice|alright|got it|i see|understood|wonderful|excellent) )+|^(?:(?:can|could|would|will) you )?(?:tell|explain|show) me (?=(?:what|how|who) )|^(?:i want to know|i would like to know|i wanna know|i would like to understand|i was wondering|i am wondering|i wonder|let me know|do you know) (?=(?:what|how|who) )/;

/** Words that make a message a legal question, never a meta one. Whole words, after normalising. */
const LEGAL_WORDS = new Set(
  (
    // English
    "police fir arrest arrested bail bailable divorce landlord tenant tenancy lease rent eviction evict evicted contract agreement property land deed employer employee salary wages wage " +
    "termination terminated fired dismissed notice section sections act article ipc bns bnss crpc cpc bsa court courts judge magistrate lawsuit sue sued suit complaint cheque bounced loan fraud cheated " +
    "theft murder rape assault harassment dowry custody alimony maintenance inheritance succession consumer refund defective warranty damages compensation injunction petition appeal " +
    "accused victim witness evidence penalty imprisonment jail prison offence offense crime criminal husband wife marriage tax gst trademark patent copyright rti gratuity pf bonus " +
    "constitution fundamental rights writ habeas stay summons warrant fine " +
    // Hindi (Devanagari)
    "पुलिस एफआईआर गिरफ्तार गिरफ्तारी जमानत तलाक मकान किराया किरायेदार मालिक अनुबंध समझौता संपत्ति जमीन ज़मीन वेतन नौकरी नोटिस धारा अधिनियम अदालत कोर्ट मुकदमा शिकायत पति पत्नी शादी दहेज उपभोक्ता सजा जेल " +
    // Hindi (Latin letters)
    "thana talaq zamanat jamanat kiraya kirayedar makan makaan vetan tankhwah naukri dhara adalat mukadma mukadama shikayat pati patni shaadi shadi dahej sampatti zameen jameen saza"
  ).split(" "),
);

/** Greeting-like small talk, answered like a greeting. Whole message. */
const GREETING_PATTERNS: RegExp[] = [
  /^how are you(?: doing| going)?$/,
  /^how is it going$/,
  /^how do you do$/,
  /^how are things$/,
  /^what is up$/,
  /^(?:is )?(?:anyone|anybody|somebody) (?:there|here)$/,
  /^are you (?:there|here|available|online)$/,
  /^(?:aap )?kaise (?:ho|hain|hai|h)(?: aap)?$/,
  /^kya (?:haal|hal) (?:hai|h)$/,
  /^(?:आप )?कैसे (?:हैं|हो|है)(?: आप)?$/,
  /^क्या हाल (?:है|हैं)$/,
];

/** Thanks, answered with a short "you're welcome". Whole part. */
const THANKS_PATTERNS: RegExp[] = [
  /^(?:many )?(?:thanks|thank you|thankyou|thx|tysm|ty|thank you so much|thanks so much)(?: (?:so|very|a lot|a ton|much|a million|again|everyone|all|bhai|ji|sir|madam))*(?: for (?:your |the |all |that |this |ur )?(?:help|time|information|info|answer|answers|reply|advice|assistance|guidance|explanation|clarification|support|quick reply))?$/,
  /^(?:i )?(?:really )?appreciate (?:it|your help|that|this)$/,
  /^(?:that|this|it) (?:was|is) (?:very |really |so )?(?:helpful|useful|great|good)(?: thanks| thank you)?$/,
  /^(?:(?:aapka|apka|tumhara|bahut|bohot|bahot) )*(?:dhanyavaad|dhanyawad|dhanyavad|dhanyvad|shukriya|shukria|shukriyaa)(?: (?:aapka|apka|ji|bahut|bohot))*$/,
  /^(?:(?:आपका|बहुत) )*(?:धन्यवाद|शुक्रिया|थैंक्स|थैंक यू)(?: (?:जी|आपका|बहुत))*$/,
];

/** Goodbyes, answered with a short farewell. Whole part. */
const BYE_PATTERNS: RegExp[] = [
  /^(?:bye+|bye bye|goodbye|good bye|see you|see you later|see you soon|see ya|take care|good night|gn|cya|ttyl|talk to you later|talk later|farewell|catch you later|tata|ta ta|that is all|that will be all|that is it|that is all for now)(?: (?:now|then|sir|madam|ji|bhai|everyone|all|for now|for today|bye))*$/,
  /^(?:alvida|phir milte hain|phir milenge|chalta hoon|chalta hu|chalti hoon|chalti hu|ab chalta hoon|chalo bye|ok bye)$/,
  /^(?:अलविदा|फिर मिलते हैं|फिर मिलेंगे|चलता हूं|चलता हूँ|चलती हूं|चलती हूँ|बाय|टाटा|शुभ रात्रि)$/,
];

/** Connectors and lead-ins that carry no request of their own: allowed next to a meta part, never enough by themselves. */
const IGNORABLE_PATTERNS: RegExp[] = [
  /^(?:and|aur|also|plus|basically|first|firstly|then|toh|to|और|एवं|तथा)$/,
  /^(?:i|we) have (?:a|one|another|some) (?:quick |small |simple |basic |general )?(?:question|questions|doubt|doubts|query)$/,
  /^(?:i|we) (?:want|wanted|would like|wish|need) to (?:ask|know|understand)(?: something| a question| one thing)?$/,
  /^(?:can|may|could) (?:i|we) ask (?:you )?(?:something|a question|one thing|a quick question|a few things)$/,
  /^(?:just )?(?:curious|wondering|asking)$/,
  /^(?:one|quick|small|simple) question$/,
  /^(?:mujhe |mera |meri |main |mai |hamara )?(?:ek )?(?:sawal|sawaal|savaal|question|doubt) (?:hai|h|puchna hai|pochna hai)$/,
  /^(?:मेरा |मुझे )?(?:एक )?(?:सवाल|प्रश्न) (?:है|पूछना है)$/,
];

const OBJECT = "(?:me|us|this|that|it|something|anything|my (?:case|problem|issue|matter|situation|query|doubts?)|the (?:case|problem|issue|matter)|a (?:problem|question))";
const WHAT_KIND = "(?:(?:ai|real|human|actual|robot|artificial|virtual|qualified|licensed|certified|genuine) )*(?:lawyer|advocate|human|bot|ai|robot|person|attorney|assistant|chatbot|machine|program)";
const SUBJECT = "(?:you|this|it|this app|this site|this assistant|this tool|chambers ?ai)";

/** Whole-message requests for help or capabilities, checked after any greeting, filler and lead-in have been taken off. */
const HELP_PATTERNS: RegExp[] = [
  // ---- English
  // help / I need help
  /^(?:(?:i|we) (?:need|want|require)|need|want) (?:some |your |a little |a bit of )?(?:help|assistance|guidance)(?: from you)?$/,
  /^(?:help|assist|assistance)(?: me| us)?(?: out)?$/,
  // can you help (me), are you able to help me with my case
  new RegExp(`^(?:can|could|will|would|do|are) you (?:be )?(?:able to |going to )?(?:really )?(?:help|assist)(?: me| us)?(?: out)?(?: (?:with|in|on|for) ${OBJECT})?$`),
  // what / how can you help (me) (with), what can you do (for me), what do you do, what do you offer, how does this work, how do you work
  new RegExp(`^(?:what|how)(?: all| else| exactly)? (?:can|could|will|would|do|does|are) ${SUBJECT}(?: really| actually| exactly| possibly)? (?:be )?(?:able to )?(?:help|assist|do|offer|provide|support|work)(?: me| us| out)*(?: (?:with|in|on|for)(?: ${OBJECT})?)?(?: for (?:me|us))?$`),
  // the same, in the order of a reported question ("tell me what you can do")
  new RegExp(`^(?:what|how) ${SUBJECT}(?: really| actually| exactly)? (?:can|could|will|would) (?:help|assist|do|offer|provide)(?: me| us| out)*(?: (?:with|in|on|for))?(?: for (?:me|us))?$`),
  // who / what are you
  /^(?:who|what) (?:are|is) (?:you|this|this app|this site|this assistant|this tool|chambers ?ai|your name)(?: really)?$/,
  /^who am i (?:talking|speaking|chatting) (?:to|with)$/,
  /^(?:tell me about yourself|introduce yourself|about you|about this app)$/,
  new RegExp(`^are you (?:an? )?${WHAT_KIND}(?: (?:or|and) (?:an? )?${WHAT_KIND})*$`),
  new RegExp(`^(?:am i (?:talking|speaking|chatting) (?:to|with)|is this) (?:an? )?${WHAT_KIND}$`),
  /^(?:tell|say) me (?:something |a bit |a little |more )?about (?:yourself|you)$/,
  /^(?:may|can|could) i (?:know|have) your name$/,
  /^(?:tell|say) me your name$/,
  /^(?:what|how) (?:should|do|can|shall) i (?:call|address) you$/,
  // how to use it
  /^how (?:do|can|to|should|could|would) (?:i )?(?:use|start|begin|get started|go about)(?: (?:you|this|it|this app|this site|chambers ?ai))?$/,
  /^(?:where|how) (?:do|should|can|to) (?:i )?(?:start|begin)$/,
  // what to ask / which topics
  /^what(?: (?:kind|kinds|type|types|sort|sorts) of)?(?: questions| things| topics)?(?: (?:can|could|should|may|do|shall|to))?(?: i| we)? ?(?:ask|talk about|discuss)(?: you| here| about| you about| from you)?$/,
  /^(?:what|which) (?:questions|topics|things|subjects|areas|issues) (?:do you|can you|are you able to) (?:answer|handle|cover|know|know about|deal with|take|help with)$/,
  /^what (?:do|can) you (?:know|cover|answer|handle|advise on|advise about|specialise in|specialize in|help with)$/,
  /^what are you (?:good|best) at$/,
  /^what are your (?:services|capabilities|features|specialities|specialisations|specializations|specialties|skills|areas)$/,
  /^what is your (?:speciality|specialty|specialisation|specialization|expertise|area of expertise)$/,
  // sample questions
  /^(?:(?:can|could|would|will) you |i (?:need|want|would like) |i d like |let me see )?(?:give|show|tell|suggest|share|send|list|recommend|provide|get|offer)(?: me| us)?(?: some| a few| any| few| a couple of| couple of| a list of| the| 3| 5| 10| three| five)?(?: (?:more|other|good|useful|popular|common|typical|sample|example|suggested|starter|starting|basic|simple|easy|possible|relevant))*(?: (?:questions?|queries|prompts|topics|examples?|suggestions?|ideas|starters))(?: (?:to ask|i can ask|i could ask|i should ask|to start with|to begin with|to get started|for me|for us))*$/,
  /^(?:i (?:need|want|would like|d like) )?(?:(?:some|a few|any|more) )?(?:(?:sample|example|suggested|starter|common|good|popular) )*(?:questions?|queries|prompts|topics|examples)(?: (?:to ask|i can ask|i could ask|i should ask|to start with|to begin with))?$/,
  /^(?:(?:any|some) )?(?:suggestions|ideas|examples)$/,

  // ---- Hindi (Devanagari)
  /^(?:मुझे |मेरी |हमें )?(?:मदद|सहायता|हेल्प)(?: चाहिए| करें| करो| कीजिए| कीजिये| करिए| कर दीजिए| करना)?$/,
  /^(?:आप )?(?:मेरी |हमारी )?(?:(?:कैसे|क्या|क्या क्या) (?:मदद |सहायता |हेल्प )?|(?:मदद |सहायता |हेल्प ))(?:करेंगे|करोगे|करेंगी|करोगी|करते हैं|करती हैं|करते हो|करती हो|कर सकते हैं|कर सकती हैं|कर सकते हो|कर सकती हो|कर पाएंगे|कर पाओगे)$/,
  /^(?:आप|तुम) (?:कौन|क्या) (?:हैं|हो|है)$/,
  /^आप कौन$/,
  /^(?:क्या )?(?:आप|तुम) (?:एक )?(?:असली |सच में |रियल )?(?:एआई|ए आई|बॉट|रोबोट|वकील|इंसान|इन्सान|मशीन)(?: हैं| हो| है)?(?: क्या)?$/,
  /^(?:आपका|तुम्हारा) नाम (?:क्या )?है$/,
  /^(?:यह|ये) क्या है$/,
  /^(?:यह|ये|यह सब) कैसे काम (?:करता|करती|करते) है$/,
  /^(?:इसका|इसे) (?:उपयोग|इस्तेमाल|प्रयोग) कैसे (?:करें|करूं|करूँ|करे)$/,
  /^(?:मैं |मुझे |हम )?(?:आपसे |यहाँ |यहां )?क्या (?:क्या )?(?:पूछूं|पूछूँ|पूछ सकता हूं|पूछ सकता हूँ|पूछ सकती हूं|पूछ सकती हूँ|पूछना चाहिए|पूछें|पूछे)$/,
  /^(?:कुछ |कोई )?(?:(?:नमूना|उदाहरण|सैंपल|सैम्पल)(?: के)? )?(?:सवाल|प्रश्न|सुझाव) (?:बताइए|बताइये|बताओ|बताएं|बताएँ|सुझाइए|दीजिए|दीजिये|दो|दिखाइए|दिखाओ)$/,
  /^(?:नमूना|उदाहरण|सैंपल|सैम्पल)(?: के)? (?:सवाल|प्रश्न)$/,

  // ---- Hindi in Latin letters (Hinglish): spellings vary, so the patterns are loose
  /^(?:meri |mujhe |hamari )?(?:madad|help|sahayata|sahayta|sahaayta)(?: karo| karna| kijiye| kijiyega| kariye| karein| karen| chahiye| chahiye please| do| dijiye| dijiyega)?$/,
  /^(?:aap |ap |app |tum )?(?:meri |hamari |mera )?(?:(?:kya kya|kya|kaise) (?:madad |help |sahayata )?|(?:madad |help |sahayata ))(?:kar|kr) (?:sakte|sakta|sakti|skte|skta|pate|paoge|payenge)(?: ho| hain| hai| h| hoon)?$/,
  /^(?:aap |ap |app |tum )?(?:meri |hamari )?(?:(?:kaise|kya) )?(?:madad|help|sahayata) (?:karenge|karengi|karoge|karogi|karogey|karege|karegi|kar dijiye|kar do)(?: ho| hain| hai| h)?$/,
  /^(?:aap |ap |app |tum )?(?:kya |kya kya )(?:karte|karti) (?:ho|hain|hai|h)$/,
  /^(?:(?:aap|ap|app|tum) )?kaun (?:ho|hain|hai|h)$/,
  /^(?:aap|ap|app|tum) kya (?:ho|hain)$/,
  /^(?:kya )?(?:aap|ap|app|tum) (?:ek )?(?:real |asli |asal |sachmuch ka )?(?:lawyer|vakil|advocate|ai|bot|robot|insaan|insan|human)(?: ho| hain| hai| h)?(?: kya)?$/,
  /^(?:kya )?(?:aap|ap|app|tum) (?:ek )?(?:real |asli )?(?:lawyer|vakil|advocate|ai|bot|robot|insaan|insan|human) (?:ho|hain)$/,
  /^(?:naam kya hai (?:aapka|apka|tumhara)|(?:aapka|apka|tumhara) naam (?:batao|bataiye|bataye|batayiye))$/,
  /^(?:aapka|apka|tumhara) naam (?:kya )?(?:hai|h)$/,
  /^(?:ye|yeh|yah) kya (?:hai|h)$/,
  /^(?:ye|yeh|yah|ye sab) kaise (?:kaam|kam) (?:karta|karti|karte) (?:hai|h)$/,
  /^(?:iska|isko|ise) (?:use|istemal|istemaal|upyog) kaise (?:karu|karun|karoon|karein|kare|karen)$/,
  /^kaise (?:shuru|start) (?:karu|karun|karoon|karein)$/,
  /^(?:main |mai |mujhe |mein |hum )?(?:aapse )?(?:kya |kya kya )p[ou]{1,2}ch(?:u|un|oon|na chahiye|na chahiyega| sakta h(?:u|un|oon)| sakti h(?:u|un|oon)| sakte hain)$/,
  /^(?:kuch |koi )?(?:sample |example |namuna )?(?:sawal|sawaal|savaal|prashn|question|questions) (?:de do|dikhao|dikhaiye|batao|bataiye|bataye|batayiye|suggest karo|do|dijiye)$/,
  /^(?:sample|example) (?:sawal|sawaal|questions?)$/,
  /^(?:kuch )?suggestions? (?:do|dijiye|batao|bataiye)$/,
];

const matches = (word: string, list: (string | RegExp)[]) => list.some((entry) => (typeof entry === "string" ? entry === word : entry.test(word)));

// Chat spellings and contractions, as whole words (after the apostrophe is kept for the contraction step).
const WORD_FIXES: Record<string, string> = { u: "you", ur: "your", r: "are", wat: "what", wht: "what", abt: "about", pls: "please", plz: "please", whats: "what is", hows: "how is", whos: "who is", im: "i am", youre: "you are", dont: "do not", ive: "i have", id: "i would" };

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\b(what|who|how|where|that|there|it)'s\b/g, "$1 is")
    .replace(/\b(i)'m\b/g, "$1 am")
    .replace(/\b(you)'re\b/g, "$1 are")
    .replace(/\b(i)'d\b/g, "$1 would")
    .replace(/\b(i)'ve\b/g, "$1 have")
    .replace(/good (?:morning|afternoon|evening|day)|gud (?:morning|afternoon|evening)|(?:shubh|subh) (?:prabhat|sandhya)/g, "hello")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) => WORD_FIXES[word] ?? word)
    .join(" ");

type PartKind = MetaIntent | "ignorable";

/** What one stretch of words is, taken as a whole: a meta intent, a connector / lead-in, or null (not meta). */
function classifyPart(words: string[]): PartKind | null {
  let start = 0;
  let greeted = false;
  while (start < words.length && (matches(words[start], GREETING_WORDS) || matches(words[start], FILLER_WORDS))) {
    if (matches(words[start], GREETING_WORDS)) greeted = true;
    start++;
  }
  let end = words.length;
  while (end > start && matches(words[end - 1], FILLER_WORDS)) end--;

  // Trailing filler is taken off, but a word like "lawyer" is also part of "are you a lawyer": the untrimmed text is tried too.
  const stripLeadIn = (text: string) => {
    for (let prev = ""; prev !== text; ) {
      prev = text;
      text = text.replace(LEAD_IN, "");
    }
    return text;
  };
  // (and the whole part untrimmed: "am" is filler after a greeting, but starts "am I talking to a real lawyer")
  const candidates = [words.slice(start, end), words.slice(start), words].map((list) => stripLeadIn(list.join(" ")));
  if (!candidates[0]) return greeted ? "greeting" : null;
  const any = (patterns: RegExp[]) => candidates.some((rest) => patterns.some((pattern) => pattern.test(rest)));
  if (any(HELP_PATTERNS)) return "help";
  if (any(BYE_PATTERNS)) return "bye";
  if (any(THANKS_PATTERNS)) return "thanks";
  if (any(GREETING_PATTERNS)) return "greeting";
  if (any(IGNORABLE_PATTERNS)) return "ignorable";
  return null;
}

/** Cuts the words into consecutive parts that are each meta (longest first, so the whole message is tried before any split). */
function segment(words: string[], from: number, memo: Map<number, PartKind[] | null>): PartKind[] | null {
  if (from === words.length) return [];
  if (memo.has(from)) return memo.get(from)!;
  let result: PartKind[] | null = null;
  for (let to = words.length; to > from && !result; to--) {
    const kind = classifyPart(words.slice(from, to));
    if (kind === null) continue;
    const rest = segment(words, to, memo);
    if (rest) result = [kind, ...rest];
  }
  memo.set(from, result);
  return result;
}

const PRIORITY: MetaIntent[] = ["help", "bye", "thanks", "greeting"];

/** "greeting", "help", "thanks", "bye", or null when the message is something else (send it to the backend). */
export function detectMetaIntent(text: string): MetaIntent | null {
  const words = normalize(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return null;
  if (words.some((word) => LEGAL_WORDS.has(word))) return null;
  const parts = segment(
    words.filter((word) => word !== "please" && word !== "kindly"), // politeness anywhere: "could you please help me"
    0,
    new Map(),
  );
  if (!parts) return null;
  return PRIORITY.find((intent) => parts.includes(intent)) ?? null; // connectors alone ("and", "i have a question") are not a request
}

/** Whether the lawyer's suggested questions are offered under the reply (not after thanks or goodbye). */
export const offersQuestions = (intent: MetaIntent) => intent === "greeting" || intent === "help";

export interface IntroSentence {
  /** Shown as the caption / chat text. */
  text: string;
  /** Said by the lawyer's voice. */
  speak: string;
}

const speakable = (s: string) => s.replace(/\bAdv\.\s+/g, "Advocate ").replace(/&/g, "and");

/** What each lawyer can help with, for the "what can you do" reply. Keyed by lawyer id, like the starter questions. */
const HELP_TOPICS: Record<string, { en: string; hi: string }> = {
  criminal: { en: "FIRs, arrests and bail, and offences such as theft", hi: "एफआईआर, गिरफ्तारी और जमानत, और चोरी जैसे अपराध" },
  family: { en: "divorce, domestic violence, maintenance and inheritance", hi: "तलाक, घरेलू हिंसा, भरण-पोषण और विरासत" },
  property: { en: "tenancy and eviction, selling and registering property, and builder delays", hi: "किरायेदारी और बेदखली, संपत्ति की बिक्री और रजिस्ट्री, और बिल्डर की देरी" },
  labour: { en: "wrongful termination, workplace harassment, wages and gratuity", hi: "गलत तरीके से नौकरी से निकालना, कार्यस्थल पर उत्पीड़न, वेतन और ग्रेच्युटी" },
  consumer: { en: "defective products, refunds and consumer complaints", hi: "दोषपूर्ण सामान, रिफ़ंड और उपभोक्ता शिकायतें" },
  constitutional: { en: "fundamental rights, RTI and your rights on arrest", hi: "मौलिक अधिकार, आरटीआई और गिरफ्तारी पर आपके अधिकार" },
};

/**
 * The reply to a greeting, help request, thanks or goodbye, in the lawyer's own role, one sentence at a time (so Meet can start
 * speaking early). A greeting gets a short hello; a help request or "who are you" says the lawyer's name and field, that this is an AI
 * assistant for Indian law and not a human lawyer, what they can help with, and invites a question; thanks and goodbye get one line.
 * Fixed app text: it cites nothing. The suggested questions follow as chips for greeting and help (offersQuestions).
 */
export function buildIntro(lawyer: Pick<Lawyer, "id" | "name" | "practice">, intent: MetaIntent, question: string): IntroSentence[] {
  const hindi = detectLang(question) === "hi";
  const hasChips = offersQuestions(intent) && getStarterQuestions(lawyer.id).length > 0;
  const practice = lawyer.practice;
  const topics = HELP_TOPICS[lawyer.id] ?? { en: `questions about ${practice.toLowerCase()}`, hi: `${practice} से जुड़े सवाल` };
  const invite = hindi
    ? hasChips
      ? "आप क्या पूछना चाहेंगे? शुरू करने के लिए कुछ सवाल ये हैं:"
      : "आप क्या पूछना चाहेंगे? अपनी स्थिति बताइए, उससे जुड़ा कानून देखा जाएगा।"
    : hasChips
      ? "What would you like to ask? Here are a few questions to start with:"
      : "What would you like to ask? Tell me about your situation and I'll look up the law that applies.";

  let lines: string[];
  if (intent === "thanks") {
    lines = hindi
      ? ["आपका स्वागत है! कोई और सवाल हो तो बेझिझक पूछिए।"]
      : [`You're welcome! If you have another question about ${practice.toLowerCase()}, just ask.`];
  } else if (intent === "bye") {
    lines = hindi ? ["अलविदा, अपना ध्यान रखिए! कोई और कानूनी सवाल हो तो फिर आइए।"] : ["Goodbye, and take care! Come back whenever you have another legal question."];
  } else if (intent === "greeting") {
    lines = hindi
      ? [`नमस्ते! मैं ${lawyer.name} हूँ, ${practice} के लिए आपकी एआई सहायक।`, "मैं भारतीय कानून के लिए एक एआई सहायक हूँ, कोई इंसानी वकील नहीं।", invite]
      : [`Hello! I'm ${lawyer.name}, the ${practice.toLowerCase()} advocate here.`, "I'm an AI assistant for Indian law, not a human lawyer.", invite];
  } else {
    lines = hindi
      ? [
          `मैं ${lawyer.name} हूँ, ${practice} के लिए आपकी एआई सहायक।`,
          "मैं भारतीय कानून के लिए एक एआई सहायक हूँ, कोई इंसानी वकील नहीं। जवाब अधिनियमों और सुप्रीम कोर्ट के फ़ैसलों पर आधारित होते हैं, और भरोसेमंद स्रोत न मिलने पर यही साफ़ बता दिया जाता है।",
          `इन विषयों में मैं आपकी मदद के लिए हूँ: ${topics.hi}।`,
          invite,
        ]
      : [
          `I'm ${lawyer.name}, the ${practice.toLowerCase()} advocate here.`,
          "I'm an AI assistant for Indian law, not a human lawyer. I answer from statutes and Supreme Court judgments, and if I don't have a reliable source, I'll say so instead of guessing.",
          `I can help with ${topics.en}.`,
          invite,
        ];
  }
  return lines.map((text) => ({ text, speak: speakable(text) }));
}
