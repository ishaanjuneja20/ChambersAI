import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_LAWYERS } from "../src/lib/demoLawyers.ts";
import { buildIntro, detectMetaIntent, MAX_WORDS, offersQuestions } from "../src/lib/metaIntent.ts";
import { getStarterQuestions } from "../src/lib/starterQuestions.ts";

describe("detectMetaIntent: greetings", () => {
  for (const text of ["hi", "Hi!", "hii", "Hello", "hello there", "Hello, sir.", "hey", "Good morning", "namaste", "Namaste ji", "नमस्ते", "नमस्कार जी", "हैलो", "हाय"]) {
    it(JSON.stringify(text), () => assert.equal(detectMetaIntent(text), "greeting"));
  }
});

describe("detectMetaIntent: help and capability requests", () => {
  for (const text of [
    "help",
    "Help!",
    "help me please",
    "I need help",
    "can you help me?",
    "how can you help me",
    "How can you help me?",
    "what can you do",
    "What can you do?",
    "what do you do",
    "who are you",
    "how does this work",
    "give me some sample questions",
    "Give me sample questions",
    "show me example questions",
    "what should I ask",
    "What should I ask you?",
    "what can I ask",
    "suggest some questions",
    "hi, what can you do?",
    "Hello! How can you help me?",
    "मदद",
    "मेरी मदद करें",
    "आप क्या कर सकते हैं",
    "आप क्या कर सकती हैं?",
    "आप मेरी क्या मदद कर सकते हैं",
    "आप कौन हैं",
    "मैं क्या पूछूं",
    "मुझे क्या पूछना चाहिए",
    "कुछ सवाल बताइए",
    "namaste, aap kya kar sakte ho",
    "madad karo",
    "mujhe kya puchna chahiye",
  ]) {
    it(JSON.stringify(text), () => assert.equal(detectMetaIntent(text), "help"));
  }
});

describe("detectMetaIntent: real questions go to the backend", () => {
  for (const text of [
    "",
    "   ",
    "What is bail?",
    "My landlord is not returning my deposit. Can you help me?",
    "Can you help me with my FIR?",
    "How can you help me get bail for my brother?",
    "Help! The police refused to register my FIR.",
    "Hello, my husband beats me. What can I do?",
    "Hi, I need help with a divorce",
    "Will the police help me if my neighbour threatens me?",
    "What can I do if my employer does not pay my salary?",
    "What should I do after an arrest?",
    "Who are you to decide my property share? Is that legal?",
    "What are the sample questions for a bail hearing in the Supreme Court?",
    "Please help",
    "तलाक के लिए क्या करना होगा",
    "मेरे मकान मालिक ने मदद नहीं की, मैं क्या करूं",
    "hide",
    "history of bail law",
  ]) {
    // "Please help" is the one that reads like a bare request: it is one (see the test below). Everything else must not match.
    if (text === "Please help") continue;
    it(JSON.stringify(text), () => assert.equal(detectMetaIntent(text), null));
  }
  it('"Please help" alone is a help request', () => assert.equal(detectMetaIntent("Please help"), "help"));
});

describe("detectMetaIntent: every phrase of the spec, with the usual variations", () => {
  const greetings = ["hi", "hello", "hey", "namaste", "good morning", "good evening", "Good Evening!", "good afternoon", "Hey there", "heyyy", "hellooo", "Hi,", "नमस्ते", "नमस्ते!", "namaste ji", "Hello sir", "hi how are you", "how are you?"];
  for (const text of greetings) it(`greeting: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), "greeting"));

  const help = [
    // what can you help (me) with
    "what can you help me with",
    "what can you help me with?",
    "What can you help me with?",
    "WHAT CAN YOU HELP ME WITH???",
    "  what   can you help me with  ",
    "what can you help with",
    "what can you help with?",
    "what can you help me with today?",
    "what all can you help me with",
    "what exactly can you help me with",
    "so what can you help me with?",
    "Hi, what can you help me with?",
    "Hello! What can you help me with, sir?",
    "wat can u help me with",
    "what can you help me out with",
    "tell me what you can do",
    "tell me what can you help me with",
    // how can you help
    "how can you help",
    "how can you help me",
    "How can you help me?",
    "how could you help me",
    "how will you help me",
    "how can you assist me",
    "how can you help me with my case",
    // what can you do / what do you do
    "what can you do",
    "What can you do?",
    "what can you do for me",
    "what do you do",
    "What do you do?",
    "what do you offer",
    "what does this app do",
    "what is this",
    "what's this?",
    // who / what are you
    "who are you",
    "Who are you?",
    "who r u",
    "what are you",
    "What are you?",
    "who is this",
    "are you a lawyer",
    "are you an AI?",
    // help
    "help",
    "Help",
    "help me",
    "Help me!",
    "help me please",
    "help me out",
    "I need help",
    "i need some help please",
    "can you help me",
    "can you help me?",
    "could you please help me",
    "are you able to help me",
    // how it works
    "how does this work",
    "How does this work?",
    "how does it work",
    "how do you work",
    "how do I use this",
    "how to use this app",
    "how do i start",
    "where do I begin",
    // sample questions
    "give me some sample questions",
    "give me some example questions",
    "Give me some sample questions.",
    "give me example questions",
    "show me sample questions",
    "can you give me some sample questions?",
    "please give me a few example questions",
    "i want some sample questions",
    "sample questions",
    "example questions",
    "any sample questions?",
    "suggest some questions",
    "Suggest some questions",
    "can you suggest some questions",
    "suggest a few questions to ask",
    "some questions to ask",
    "give me ideas",
    // what to ask
    "what should I ask",
    "What should I ask?",
    "what should i ask you",
    "what can I ask",
    "What can I ask?",
    "what can I ask here",
    "what can I ask you about",
    "what do I ask",
    "what to ask",
    "what questions can I ask",
    "what kind of questions can I ask you",
    "what topics do you cover",
    // Hindi
    "मदद",
    "मदद चाहिए",
    "मुझे मदद चाहिए",
    "मेरी मदद करें",
    "आप क्या कर सकते हैं",
    "आप क्या कर सकते हैं?",
    "आप कैसे मदद करेंगे",
    "कैसे मदद करेंगे",
    "आप मेरी कैसे मदद कर सकते हैं",
    "आप मेरी क्या मदद कर सकते हैं",
    "आप क्या करते हैं",
    "आप कौन हैं",
    "ये कैसे काम करता है",
    "मुझे क्या पूछना चाहिए",
    "मैं क्या पूछूं",
    "मैं क्या पूछ सकता हूं",
    "कुछ सवाल बताइए",
    "कुछ उदाहरण सवाल दीजिए",
    "नमस्ते, आप कैसे मदद करेंगे?",
    // Hinglish
    "kya kar sakte ho",
    "Kya kar sakte ho?",
    "aap kya kar sakte ho",
    "aap kya kya kar sakte ho",
    "aap kya madad kar sakte hain",
    "Aap kya madad kar sakte hain?",
    "aap meri kya madad kar sakte hain",
    "aap kaise madad karenge",
    "aap meri kaise madad karoge",
    "kaise madad karenge",
    "aap kya karte hain",
    "aap kaun ho",
    "aap kaun hain",
    "mujhe kya poochna chahiye",
    "Mujhe kya puchna chahiye?",
    "main kya puchu",
    "kya pooch sakta hu",
    "madad",
    "madad karo",
    "meri madad karo",
    "mujhe madad chahiye",
    "help karo",
    "ye kaise kaam karta hai",
    "kuch sawal batao",
    "sample sawal do",
    "namaste, kya kar sakte ho",
    "namaste aap kya madad kar sakte hain?",
  ];
  for (const text of help) it(`help: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), "help"));
});

describe("detectMetaIntent: legal questions are never meta, even with 'help' in them", () => {
  const legal = [
    "Can you help me understand if my landlord can evict me without notice?",
    "help with divorce papers",
    "Help with divorce papers?",
    "help me file an FIR",
    "can you help me with bail",
    "what can you do about my landlord",
    "what can you help me with regarding my property dispute",
    "how can you help me get my salary",
    "I need help, the police arrested my brother",
    "help me with a tenant who stopped paying rent",
    "what can I ask about section 498A",
    "what should I ask the court",
    "who are you to say that the contract is void",
    "how does bail work",
    "sample questions on divorce",
    "give me some sample questions about property law",
    "suggest some questions for my employer notice",
    "मेरी मदद करें, पुलिस ने एफआईआर नहीं लिखी",
    "मदद करें मेरा तलाक हो रहा है",
    "madad karo mere landlord ne ghar se nikal diya",
    "mujhe kya puchna chahiye talaq ke liye",
  ];
  for (const text of legal) it(`goes to the backend: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), null));

  it("a message of more than 12 words is never meta, even if it starts like a help request", () => {
    const long = "what can you help me with because I have been thinking about many things lately and I am not sure";
    assert.ok(long.split(" ").length > MAX_WORDS);
    assert.equal(detectMetaIntent(long), null);
    assert.equal(MAX_WORDS, 12);
    assert.equal(detectMetaIntent("what can you help me with " + "really ".repeat(12)), null);
  });

  it("other things that merely start like a help request are not meta either", () => {
    for (const text of ["Can you help me understand what happens next?", "what can you tell me about the constitution", "how can I stay calm during questioning", "how does a will work", "who are you to judge", "what do you do if someone stops you"]) {
      assert.equal(detectMetaIntent(text), null, text);
    }
  });
});

describe("buildIntro", () => {
  const lawyer = DEMO_LAWYERS.find((l) => l.id === "criminal");
  const text = (sentences) => sentences.map((s) => s.text).join(" ");

  it("a help request names the lawyer and field, says AI and not a human lawyer, lists what they help with, and invites a question", () => {
    const sentences = buildIntro(lawyer, "help", "who are you");
    assert.equal(sentences.length, 4);
    assert.match(sentences[0].text, /^I'm Adv\. Rhea Kapoor, the criminal law advocate here\.$/);
    const all = text(sentences);
    assert.match(all, /AI assistant for Indian law, not a human lawyer/);
    assert.match(all, /statutes and Supreme Court judgments/);
    assert.match(all, /don't have a reliable source/);
    assert.match(sentences[2].text, /^I can help with .*\bbail\b/);
    assert.match(sentences[3].text, /^What would you like to ask\?.*:$/);
    assert.ok(getStarterQuestions("criminal").length > 0);
  });
  it("a greeting is a short hello that still says AI, not a human lawyer, and invites a question", () => {
    const sentences = buildIntro(lawyer, "greeting", "hello");
    assert.equal(sentences.length, 3);
    assert.match(sentences[0].text, /^Hello! I'm Adv\. Rhea Kapoor, the criminal law advocate here\.$/);
    assert.match(text(sentences), /AI assistant for Indian law, not a human lawyer/);
    assert.match(sentences[2].text, /^What would you like to ask\?/);
  });
  it("has no greeting word for a help request, and nothing that looks like a citation", () => {
    for (const intent of ["help", "greeting", "thanks", "bye"]) {
      const sentences = buildIntro(lawyer, intent, "what can you do");
      assert.ok(!sentences.some((s) => /\[\d+\]|\bs\.\d+|\bsection \d+/i.test(s.text)), intent);
    }
    assert.match(buildIntro(lawyer, "help", "what can you do")[0].text, /^I'm Adv\. Rhea Kapoor/);
  });
  it("speaks the title in full and says 'and' for '&'", () => {
    const family = DEMO_LAWYERS.find((l) => l.id === "family");
    const first = buildIntro(family, "help", "help")[0];
    assert.match(first.text, /family & divorce advocate/);
    assert.match(first.speak, /^I'm Advocate .* family and divorce advocate here\.$/);
  });
  it("answers in Hindi to a Hindi message, without a gendered verb for the lawyer", () => {
    for (const intent of ["greeting", "help", "thanks", "bye"]) {
      const sentences = buildIntro(lawyer, intent, "नमस्ते");
      assert.ok(sentences.every((s) => /[\u0900-\u097F]/.test(s.text)), intent);
    }
    const hello = buildIntro(lawyer, "greeting", "नमस्ते");
    assert.match(hello[0].text, /^नमस्ते!/);
    assert.ok(hello.some((s) => s.text.includes("भारतीय कानून")));
    assert.ok(buildIntro(lawyer, "help", "आप कौन हैं").some((s) => s.text.includes("इंसानी वकील नहीं")));
  });
  it("every lawyer gets an intro in their own name and field, with their own topics", () => {
    const topics = new Set();
    for (const l of DEMO_LAWYERS) {
      const sentences = buildIntro(l, "help", "help");
      assert.equal(sentences.length, 4, l.id);
      assert.ok(sentences[0].text.includes(l.name), l.id);
      assert.ok(sentences[0].text.toLowerCase().includes(l.practice.toLowerCase()), l.id);
      topics.add(sentences[2].text);
    }
    assert.equal(topics.size, DEMO_LAWYERS.length);
  });
  it("without suggested questions the invitation asks for the situation instead of pointing at chips", () => {
    const sentences = buildIntro({ id: "unknown", name: "Adv. Test", practice: "Tax Law" }, "help", "help");
    assert.match(sentences[2].text, /tax law/);
    assert.match(sentences[3].text, /Tell me about your situation/);
  });
  it("thanks and goodbye get one short line, and no suggested questions", () => {
    for (const intent of ["thanks", "bye"]) {
      const sentences = buildIntro(lawyer, intent, intent);
      assert.equal(sentences.length, 1, intent);
      assert.ok(sentences[0].text.length < 120, intent);
      assert.ok(!offersQuestions(intent), intent);
    }
    assert.match(buildIntro(lawyer, "thanks", "thanks")[0].text, /^You're welcome!/);
    assert.match(buildIntro(lawyer, "bye", "bye")[0].text, /^Goodbye/);
    assert.ok(offersQuestions("greeting") && offersQuestions("help"));
  });
});

describe("detectMetaIntent: identity and capability phrases, case and punctuation aside, anywhere in a short message", () => {
  const phrases = [
    "who are you",
    "what are you",
    "what can you do",
    "what can you help me with",
    "how can you help",
    "introduce yourself",
    "tell me about yourself",
    "are you a real lawyer",
    "are you an AI",
    "how does this work",
    "what is your name",
    "aap kaun ho",
    "tum kya kar sakte ho",
    "aap kya kar sakte hain",
  ];
  for (const phrase of phrases) {
    it(`${JSON.stringify(phrase)} on its own, upper case, with punctuation`, () => {
      assert.equal(detectMetaIntent(phrase), "help");
      assert.equal(detectMetaIntent(phrase.toUpperCase()), "help");
      assert.equal(detectMetaIntent(`${phrase}?`), "help");
      assert.equal(detectMetaIntent(`  ...${phrase.replace(/ /g, ",  ")}!!  `), "help");
    });
    it(`${JSON.stringify(phrase)} after a greeting or a lead-in, or before a connector and a second phrase`, () => {
      assert.equal(detectMetaIntent(`hey, ${phrase}`), "help");
      assert.equal(detectMetaIntent(`hello sir, ${phrase} please`), "help");
      assert.equal(detectMetaIntent(`ok so ${phrase}`), "help");
      assert.equal(detectMetaIntent(`I have a question, ${phrase}`), "help");
      assert.equal(detectMetaIntent(`${phrase} and who are you`), "help");
    });
  }
  for (const text of [
    "Hi! Who are you and what can you do?",
    "so tell me what is your name",
    "um who are you and what can you do",
    "are you an AI or a human lawyer?",
    "are you a real lawyer or a bot",
    "Is this a real lawyer?",
    "am I talking to a real person",
    "tell me something about yourself",
    "what should I call you",
    "hello aap kaun ho aur kya kar sakte ho",
    "aap kaun ho bhai",
    "namaste, tum kya kar sakte ho?",
    "kya aap real lawyer ho",
    "क्या आप एआई हैं",
    "क्या आप असली वकील हैं?",
    "आप कौन हैं और क्या कर सकते हैं",
    "can you tell me what you can do for me",
    "tell me what can you help me with",
  ]) {
    it(`help: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), "help"));
  }
});

describe("detectMetaIntent: greetings, thanks and goodbyes", () => {
  for (const text of ["hi", "hello", "Namaste", "namaste ji", "नमस्ते", "hey there", "good morning", "how are you"]) {
    it(`greeting: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), "greeting"));
  }
  for (const text of [
    "thanks",
    "Thanks!",
    "thank you",
    "Thank you so much",
    "thank u",
    "thanks a lot",
    "thanks for your help",
    "thank you for the information",
    "ok thanks",
    "great, thanks",
    "hi thanks",
    "many thanks",
    "thx",
    "dhanyavaad",
    "bahut shukriya",
    "aapka bahut dhanyavaad",
    "धन्यवाद",
    "बहुत शुक्रिया",
  ]) {
    it(`thanks: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), "thanks"));
  }
  for (const text of ["bye", "Bye!", "bye bye", "goodbye", "good night", "see you", "see you later", "take care", "ok bye", "alvida", "अलविदा", "thanks, bye", "thank you and goodbye"]) {
    it(`bye: ${JSON.stringify(text)}`, () => assert.equal(detectMetaIntent(text), "bye"));
  }
  it("a question wins over thanks or a greeting that comes with it", () => {
    assert.equal(detectMetaIntent("thanks, who are you"), "help");
    assert.equal(detectMetaIntent("hello thanks what can you do"), "help");
    assert.equal(detectMetaIntent("hi, bye"), "bye");
  });
});

describe("detectMetaIntent: a real question that merely contains 'help' (or 'thanks', 'who are you') still goes to the backend", () => {
  for (const text of [
    "Can you help me understand if my landlord can evict me without notice?",
    "help me with bail",
    "how can you help with my FIR",
    "who are you to judge my case",
    "what can you do about my neighbour's dog",
    "help, my husband is threatening me",
    "who are you and can you stop my landlord evicting me",
    "thanks, now what is the punishment for theft",
    "thank you, but how do I file a consumer complaint",
    "what can you help me with about my divorce",
    "can you help me write a letter to my employer",
    "I need help with my property dispute",
    "are you able to help me get a refund",
    "bye the way, what is section 420",
    "I have a question",
    "and",
    "so",
    "tell me",
  ]) {
    it(JSON.stringify(text), () => assert.equal(detectMetaIntent(text), null));
  }
  it("a longer message is never meta, even if it is made of meta phrases", () => {
    const long = "hello hello hello who are you and what can you do for me today please";
    assert.ok(long.split(" ").length > MAX_WORDS);
    assert.equal(detectMetaIntent(long), null);
    assert.equal(detectMetaIntent("who are you and what can you do for me"), "help"); // 10 words
  });
});
