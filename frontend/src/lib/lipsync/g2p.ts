// Text -> viseme sequence ("phones") with the source character each one came from, so timing that is
// known per character group (Fish Audio word / syllable timestamps) can be carried onto each phone.
//   English          spelling rules (no dictionary; visemes merge many phonemes, so rules are enough)
//   Hindi, Devanagari syllable (akshara) parsing with Hindi schwa deletion
//   Hinglish (Latin)  romanized-Hindi rules: "th"/"dh" are dental stops, "e" is never silent
import type { Viseme } from "./visemes";

export type Lang = "en" | "hi";

export interface Phone {
  v: Viseme;
  w: number; // relative duration
  s: number; // strength 0..1 (schwa and glides are weaker)
  ci: number; // index of the source character in the full text
}

type Local = [Viseme, number, number, number]; // viseme, weight, strength, index within the token

const VOW = 1;
const DIPH = 0.6;
const STOP = 0.55;
const FRIC = 0.75;
const NAS = 0.6;
const GLIDE = 0.5;

const DEVANAGARI = /[ऀ-ॿ]/;

/** Acoustic class, used to place phones on the audio: V vowel, S stop, F fricative, N nasal/liquid/glide. */
export type PhoneClass = "V" | "S" | "F" | "N";

export function phoneClass(p: Pick<Phone, "v" | "w">): PhoneClass {
  if (p.w === GLIDE) return "N";
  switch (p.v) {
    case "aa": case "E": case "I": case "O": case "U": return "V";
    case "PP": case "DD": case "kk": return p.w === NAS ? "N" : "S";
    case "FF": case "TH": case "SS": case "CH": return "F";
    default: return "N";
  }
}

// ---------------------------------------------------------------- language detection

const HINGLISH_WORDS = new Set(
  ("hai hain tha thi the ho hoga hogi kya kyu kyun kaise kaun kab kahan kitna mera meri mere mujhe mujhko " +
    "hum hamara hamare aap aapka aapki aapke tum tumhara uska uski unka unki unke apna apni apne ka ki ke ko " +
    "se mein main me par pe aur ya nahi nahin na bhi to toh agar lekin magar kuch koi sab bahut zyada kam " +
    "karna karta karti karte kiya kiye karo karein kar raha rahi rahe sakta sakti sakte chahiye chahta " +
    "chahti diya liya gaya gayi gaye ghar paisa paise police thana adalat kanoon kanooni vakil adhikar " +
    "adhikaron baare jaankari bina kaaran roka saath wala wali wale")
    .split(" "),
);

export function detectLang(text: string): Lang {
  if (DEVANAGARI.test(text)) return "hi";
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = words.filter((w) => HINGLISH_WORDS.has(w)).length;
  return hits >= 2 && hits >= words.length * 0.2 ? "hi" : "en";
}

// ---------------------------------------------------------------- numbers and acronyms

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + numberWords(n % 100) : "");
  for (const [size, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]] as const) {
    if (n >= size) return numberWords(Math.floor(n / size)) + " " + name + (n % size ? " " + numberWords(n % size) : "");
  }
  return "";
}

// Letter names for acronyms read out letter by letter (IPC, FIR, BNSS).
const LETTER_NAMES: Record<string, string> = {
  a: "ay", b: "bee", c: "see", d: "dee", e: "ee", f: "ef", g: "jee", h: "aych", i: "eye", j: "jay", k: "kay",
  l: "el", m: "em", n: "en", o: "oh", p: "pee", q: "kyoo", r: "ar", s: "es", t: "tee", u: "you", v: "vee",
  w: "dubloo", x: "eks", y: "why", z: "zed",
};

// ---------------------------------------------------------------- English

// Frequent words the spelling rules get wrong, respelled so the rules read them correctly.
const RESPELL: Record<string, string> = {
  have: "hav", give: "giv", live: "liv", love: "luv", come: "cum", some: "sum", done: "dun", none: "nun",
  one: "wun", once: "wuns", two: "too", to: "too", do: "doo", who: "hoo", you: "yoo", your: "yor",
  the: "thuh", a: "uh", of: "uv", are: "ar", were: "wer", was: "wuz", said: "sed", says: "sez", been: "bin",
  there: "thair", their: "thair", where: "wair", what: "wut", does: "duz", any: "enny", many: "menny",
  only: "ohnly", into: "intoo", against: "agenst", court: "kort", law: "lor", lawyer: "loyer", should: "shud",
  would: "wud", could: "kud", right: "rite", rights: "rites", police: "poleess", procedure: "proseejur",
};

function englishWord(word: string): Local[] {
  const w = RESPELL[word.toLowerCase()] ?? word.toLowerCase();
  const out: Local[] = [];
  const isVowel = (c: string | undefined) => !!c && "aeiou".includes(c);
  const magicE = (i: number) => !isVowel(w[i + 1]) && w[i + 1] !== undefined && w[i + 2] === "e" && i + 3 === w.length;
  const open = (i: number) => !isVowel(w[i + 1]) && w[i + 1] !== undefined && isVowel(w[i + 2]);
  const push = (v: Viseme, wt: number, s: number, ci: number) => out.push([v, wt, s, ci]);
  let i = 0;
  while (i < w.length) {
    const c = w[i];
    const rest = w.slice(i);
    if (c === "e" && i === w.length - 1 && w.length > 2 && !isVowel(w[i - 1])) break; // silent final e
    if (rest.startsWith("tion") || rest.startsWith("sion")) {
      push("CH", FRIC, 1, i); push("aa", VOW * 0.6, 0.5, i + 2); push("nn", NAS, 1, i + 3); i += 4; continue;
    }
    if (rest.startsWith("tch")) { push("CH", FRIC, 1, i); i += 3; continue; }
    if (rest.startsWith("igh")) { push("aa", DIPH, 0.9, i); push("I", DIPH, 0.8, i); i += 3; continue; }
    if (rest.startsWith("ough") || rest.startsWith("augh")) { push("O", VOW, 1, i); i += 4; continue; }
    const two = rest.slice(0, 2);
    const digraph: Record<string, Array<[Viseme, number, number]>> = {
      sh: [["CH", FRIC, 1]], ch: [["CH", FRIC, 1]], zh: [["CH", FRIC, 1]], th: [["TH", FRIC, 1]],
      ph: [["FF", FRIC, 1]], wh: [["U", GLIDE, 0.6]], ck: [["kk", STOP, 1]], ng: [["nn", NAS, 1]],
      qu: [["kk", STOP, 1], ["U", GLIDE, 0.6]], gh: i === 0 ? [["kk", STOP, 1]] : [],
      ee: [["I", VOW, 1]], ea: [["I", VOW, 1]], ie: [["I", VOW, 1]], oo: [["U", VOW, 1]], ue: [["U", VOW, 1]],
      ew: [["U", VOW, 1]], ui: [["U", VOW, 1]], ou: [["aa", DIPH, 0.8], ["U", DIPH, 0.7]],
      ow: [["aa", DIPH, 0.8], ["U", DIPH, 0.7]], ai: [["E", DIPH, 1], ["I", DIPH, 0.6]],
      ay: [["E", DIPH, 1], ["I", DIPH, 0.6]], ei: [["E", DIPH, 1], ["I", DIPH, 0.6]],
      ey: [["E", DIPH, 1], ["I", DIPH, 0.6]], oi: [["O", DIPH, 1], ["I", DIPH, 0.7]],
      oy: [["O", DIPH, 1], ["I", DIPH, 0.7]], au: [["O", VOW, 1]], aw: [["O", VOW, 1]], oa: [["O", VOW, 1]],
    };
    if (two.length === 2 && digraph[two]) {
      for (const [v, wt, s] of digraph[two]) push(v, wt, s, i);
      i += 2;
      continue;
    }
    if (c === w[i - 1] && !isVowel(c)) { i++; continue; } // doubled consonant
    switch (c) {
      case "a": magicE(i) ? (push("E", DIPH, 1, i), push("I", DIPH, 0.6, i)) : push("aa", VOW, 1, i); break;
      case "e": push("E", VOW, 1, i); break;
      case "i": magicE(i) ? (push("aa", DIPH, 0.9, i), push("I", DIPH, 0.8, i)) : push("I", VOW, 1, i); break;
      case "o": push("O", VOW, 1, i); break;
      case "u": open(i) || magicE(i) ? push("U", VOW, 1, i) : push("aa", VOW, 0.8, i); break;
      case "y":
        if (i === 0) push("I", GLIDE, 0.6, i);
        else if (i === w.length - 1 && !/[aeiou]/.test(w.slice(0, i))) (push("aa", DIPH, 0.9, i), push("I", DIPH, 0.8, i)); // my, by, why
        else push("I", VOW, 1, i);
        break;
      case "b": case "p": push("PP", STOP, 1, i); break;
      case "m": push("PP", NAS, 1, i); break;
      case "f": case "v": push("FF", FRIC, 1, i); break;
      case "t": case "d": push("DD", STOP, 1, i); break;
      case "k": case "q": push("kk", STOP, 1, i); break;
      case "c": "eiy".includes(w[i + 1] ?? "") ? push("SS", FRIC, 1, i) : push("kk", STOP, 1, i); break;
      case "g": "eiy".includes(w[i + 1] ?? "") && i + 1 < w.length - 1 ? push("CH", FRIC, 1, i) : push("kk", STOP, 1, i); break;
      case "s": case "z": push("SS", FRIC, 1, i); break;
      case "x": push("kk", STOP, 1, i); push("SS", FRIC, 1, i); break;
      case "l": case "n": push("nn", NAS, 1, i); break;
      case "r": push("RR", GLIDE, 0.8, i); break;
      case "w": push("U", GLIDE, 0.6, i); break;
      case "j": push("CH", FRIC, 1, i); break;
      default: break; // h and anything else: no visible shape of its own
    }
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- Hindi, Devanagari

const DEV_CONS: Record<string, [Viseme, number, number]> = {};
const setCons = (chars: string, v: Viseme, wt: number, s = 1) => { for (const ch of chars) DEV_CONS[ch] = [v, wt, s]; };
setCons("कखगघ", "kk", STOP);
setCons("ङञणनल", "nn", NAS);
setCons("चछजझशष", "CH", FRIC);
setCons("टठडढतथदध", "DD", STOP);
setCons("पफबभम", "PP", STOP);
setCons("य", "I", GLIDE, 0.6);
setCons("र", "RR", GLIDE, 0.8);
setCons("व", "FF", GLIDE, 0.6); // [ʋ]: light lower-lip contact
setCons("स", "SS", FRIC);
DEV_CONS["ह"] = ["sil", 0, 0]; // ह: aspiration only
// Nukta letters, registered both precomposed (U+0958-095F) and as base + nukta: NFC never recombines them.
const NUKTA_FORMS: Array<[string, Viseme, number, number]> = [
  ["क़", "kk", STOP, 1], ["ख़", "kk", STOP, 1], ["ग़", "kk", STOP, 1], ["ज़", "SS", FRIC, 1],
  ["ड़", "RR", GLIDE, 0.8], ["ढ़", "RR", GLIDE, 0.8], ["फ़", "FF", FRIC, 1], ["य़", "I", GLIDE, 0.6],
];
for (const [ch, v, wt, s] of NUKTA_FORMS) {
  DEV_CONS[ch] = [v, wt, s];
  DEV_CONS[ch.normalize("NFD")] = [v, wt, s];
}

const DEV_VOWEL: Record<string, [Viseme, number, number]> = {
  "अ": ["aa", 0.55, 0.6], // अ / inherent schwa
  "आ": ["aa", VOW, 1], "ा": ["aa", VOW, 1],
  "इ": ["I", 0.8, 0.9], "ि": ["I", 0.8, 0.9], "ई": ["I", VOW, 1], "ी": ["I", VOW, 1],
  "उ": ["U", 0.8, 0.9], "ु": ["U", 0.8, 0.9], "ऊ": ["U", VOW, 1], "ू": ["U", VOW, 1],
  "ए": ["E", VOW, 1], "े": ["E", VOW, 1], "ऐ": ["E", VOW, 1], "ै": ["E", VOW, 1],
  "ओ": ["O", VOW, 1], "ो": ["O", VOW, 1], "औ": ["O", VOW, 1], "ौ": ["O", VOW, 1],
  "ऑ": ["O", VOW, 1], "ॉ": ["O", VOW, 1],
  "ऋ": ["RR", VOW, 0.8], "ृ": ["RR", VOW, 0.8],
};
const VIRAMA = "्";
const NUKTA = "़";
const NASALS = "ँं"; // candrabindu, anusvara
const LABIAL = "पफबभम";

interface Akshara {
  cons: Array<{ ch: string; ci: number }>;
  vowel: string | null; // null = virama / deleted schwa
  vci: number;
  inherent: boolean;
  nasal: number; // char index of anusvara/candrabindu, -1 if none
}

function devanagariWord(word: string): Local[] {
  const ak: Akshara[] = [];
  let joining = false;
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const cur = ak[ak.length - 1];
    if (ch === NUKTA && cur) {
      const last = cur.cons[cur.cons.length - 1];
      if (last) last.ch += NUKTA;
    } else if (DEV_CONS[ch] !== undefined) {
      if (joining && cur) cur.cons.push({ ch, ci: i });
      else ak.push({ cons: [{ ch, ci: i }], vowel: "अ", vci: i, inherent: true, nasal: -1 });
      joining = false;
    } else if (ch === VIRAMA && cur) {
      cur.vowel = null;
      cur.inherent = false;
      joining = true;
    } else if (DEV_VOWEL[ch] && ch >= "ा" && cur) {
      cur.vowel = ch; cur.vci = i; cur.inherent = false;
    } else if (DEV_VOWEL[ch]) {
      ak.push({ cons: [], vowel: ch, vci: i, inherent: false, nasal: -1 });
    } else if (NASALS.includes(ch) && cur) {
      cur.nasal = i;
    }
  }
  // Schwa deletion: word-final, then medial V C(ə) C V, scanning right to left.
  const n = ak.length;
  if (n > 1 && ak[n - 1].inherent) ak[n - 1].vowel = null;
  for (let i = n - 2; i >= 1; i--) {
    const a = ak[i];
    if (a.inherent && a.vowel && a.cons.length === 1 && ak[i - 1].vowel && ak[i + 1].vowel && ak[i + 1].cons.length > 0) {
      a.vowel = null;
    }
  }
  const out: Local[] = [];
  ak.forEach((a, idx) => {
    for (const c of a.cons) {
      const m = DEV_CONS[c.ch] ?? DEV_CONS[c.ch[0]];
      if (m && m[0] !== "sil") out.push([m[0], m[1], m[2], c.ci]);
    }
    if (a.vowel) {
      const [v, wt, s] = DEV_VOWEL[a.vowel];
      out.push([v, wt, s, a.vci]);
    }
    if (a.nasal >= 0 && idx < ak.length - 1) {
      const next = ak[idx + 1].cons[0]?.ch ?? "";
      out.push([LABIAL.includes(next) ? "PP" : "nn", NAS * 0.7, 0.8, a.nasal]);
    }
  });
  return out;
}

// ---------------------------------------------------------------- Hinglish (romanized Hindi)

function romanHindiWord(word: string): Local[] {
  const w = word.toLowerCase();
  const out: Local[] = [];
  const multi: Array<[string, Array<[Viseme, number, number]>]> = [
    ["chh", [["CH", FRIC, 1]]], ["aa", [["aa", VOW, 1]]], ["ee", [["I", VOW, 1]]], ["ii", [["I", VOW, 1]]],
    ["oo", [["U", VOW, 1]]], ["uu", [["U", VOW, 1]]], ["ai", [["E", VOW, 1]]], ["ei", [["E", VOW, 1]]],
    ["au", [["O", VOW, 1]]], ["ch", [["CH", FRIC, 1]]], ["sh", [["CH", FRIC, 1]]], ["jh", [["CH", FRIC, 1]]],
    ["kh", [["kk", STOP, 1]]], ["gh", [["kk", STOP, 1]]], ["th", [["DD", STOP, 1]]], ["dh", [["DD", STOP, 1]]],
    ["ph", [["FF", FRIC, 1]]], ["bh", [["PP", STOP, 1]]],
  ];
  const single: Record<string, [Viseme, number, number]> = {
    e: ["E", VOW, 1], i: ["I", 0.8, 0.9], o: ["O", VOW, 1], u: ["U", 0.8, 0.9], y: ["I", GLIDE, 0.6],
    w: ["FF", GLIDE, 0.6], v: ["FF", GLIDE, 0.6], f: ["FF", FRIC, 1], k: ["kk", STOP, 1], q: ["kk", STOP, 1],
    g: ["kk", STOP, 1], c: ["kk", STOP, 1], j: ["CH", FRIC, 1], z: ["SS", FRIC, 1], s: ["SS", FRIC, 1],
    t: ["DD", STOP, 1], d: ["DD", STOP, 1], n: ["nn", NAS, 1], l: ["nn", NAS, 1], r: ["RR", GLIDE, 0.8],
    m: ["PP", NAS, 1], b: ["PP", STOP, 1], p: ["PP", STOP, 1],
  };
  let i = 0;
  while (i < w.length) {
    const hit = multi.find(([k]) => w.startsWith(k, i));
    if (hit) {
      for (const [v, wt, s] of hit[1]) out.push([v, wt, s, i]);
      i += hit[0].length;
      continue;
    }
    const c = w[i];
    if (c === "a") out.push(i === w.length - 1 ? ["aa", VOW, 1, i] : ["aa", 0.55, 0.6, i]); // final a is long
    else if (c === "x") out.push(["kk", STOP, 1, i], ["SS", FRIC, 1, i]);
    else if (single[c] && !(c === w[i - 1] && !"eiou".includes(c))) out.push([...single[c], i]);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- whole text

const TOKEN = /[\p{L}\p{M}\p{N}]+(?:['’]\p{L}+)?|[.,;:!?।॥]/gu;
const PAUSE: Record<string, number> = { ",": 0.9, ";": 1.1, ":": 1.1, ".": 1.6, "!": 1.6, "?": 1.6, "।": 1.6, "॥": 1.6 };

/** Phones for a whole text. `pauses` adds silent phones for punctuation (only wanted when no timing exists). */
export function textToPhones(text: string, lang: Lang, pauses = false): Phone[] {
  const phones: Phone[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const tok = m[0];
    const at = m.index ?? 0;
    if (PAUSE[tok] !== undefined) {
      if (pauses) phones.push({ v: "sil", w: PAUSE[tok], s: 0, ci: at });
      continue;
    }
    let local: Local[];
    if (DEVANAGARI.test(tok)) local = devanagariWord(tok);
    else if (/^\d+$/.test(tok)) {
      // Spoken form is unknown (Hindi or English number words); English words give a comparable mouth rhythm.
      local = numberWords(Math.min(Number(tok), 999_999_999)).split(" ").flatMap((word) => englishWord(word).map(([v, wt, s]) => [v, wt, s, 0] as Local));
    } else if (/^[A-Z]{2,5}$/.test(tok)) {
      local = [...tok.toLowerCase()].flatMap((ch, k) => englishWord(LETTER_NAMES[ch] ?? ch).map(([v, wt, s]) => [v, wt, s, k] as Local));
    } else local = lang === "hi" ? romanHindiWord(tok) : englishWord(tok);
    for (const [v, w, s, k] of local) phones.push({ v, w, s, ci: at + Math.min(k, tok.length - 1) });
  }
  return phones;
}
