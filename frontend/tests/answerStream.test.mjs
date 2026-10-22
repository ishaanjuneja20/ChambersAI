// General-guidance answers (`general: true`), the voice notice that goes with them, and what happens when the backend call fails,
// times out or ends without an answer: always a friendly message and an ending, never a blank answer or a wait that never stops.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ASK_FAILED_MESSAGE, ASK_TIMEOUT_MS, AskHttpError, AskTimeoutError, askStream, toAskEvent } from "../src/lib/askApi.ts";
import { runAnswerStream } from "../src/lib/answerStream.ts";
import { DEMO_LAWYERS } from "../src/lib/demoLawyers.ts";
import { buildIntro } from "../src/lib/metaIntent.ts";
import { SHOW_GENERAL_NOTICE } from "../src/lib/config.ts";
import { GENERAL_TAG, generalSpokenNotice, showGeneralNotice } from "../src/lib/generalAnswer.ts";
import { routeQuestion } from "../src/lib/questionRoute.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const collect = async (gen) => {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A fetch() whose body delivers `steps`: a string is sent, a number waits that many ms. Honors abort like the real one. */
function streamingFetch(steps) {
  globalThis.fetch = async (_url, init) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        for (const step of steps) {
          if (typeof step === "number") await sleep(step);
          else if (!init.signal?.aborted) controller.enqueue(encoder.encode(step));
        }
        if (!init.signal?.aborted) controller.close();
      },
    });
    return new Response(body, { status: 200 });
  };
}

/** A fetch() that never answers (the server is hung), but rejects when aborted. */
function hungFetch() {
  globalThis.fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const abort = () => reject(new DOMException("aborted", "AbortError"));
      if (init.signal?.aborted) abort(); // like the real fetch
      else init.signal?.addEventListener("abort", abort);
    });
}

describe("general: true on the wire", () => {
  it("sentence and done events carry it only when it is true, and drop any citations", () => {
    assert.deepEqual(toAskEvent({ type: "sentence", text: "A.", speak: "A.", new_citations: [], general: true }), { type: "sentence", text: "A.", speak: "A.", newCitations: [], general: true });
    assert.deepEqual(toAskEvent({ type: "sentence", text: "A.", speak: "A.", new_citations: [{ n: 1, text: "BNS s.103" }], general: true }).newCitations, []);
    assert.deepEqual(toAskEvent({ type: "done", citations: [], general: true }), { type: "done", citations: [], general: true });
    assert.deepEqual(toAskEvent({ type: "done", citations: ["BNS s.103"], general: true }).citations, []);
    // a cited answer's events are exactly as before
    assert.ok(!("general" in toAskEvent({ type: "sentence", text: "A [1].", speak: "A.", new_citations: [{ n: 1, text: "BNS s.103" }] })));
    assert.ok(!("general" in toAskEvent({ type: "done", citations: ["BNS s.103"] })));
    assert.ok(!("general" in toAskEvent({ type: "done", citations: [], general: false })));
  });

  it("askStream yields the general flag from the stream", async () => {
    streamingFetch([sse({ type: "sentence", text: "Talk to a lawyer.", speak: "Talk to a lawyer.", new_citations: [], general: true }), sse({ type: "done", citations: [], general: true })]);
    const events = await collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test" }));
    assert.deepEqual(
      events.map((e) => [e.type, e.general]),
      [
        ["sentence", true],
        ["done", true],
      ],
    );
  });
});

describe("generalSpokenNotice and the tag", () => {
  it("the notice is hidden by default", () => {
    assert.equal(SHOW_GENERAL_NOTICE, false);
    assert.equal(showGeneralNotice(true), false);
    assert.equal(generalSpokenNotice("You may file a complaint with the police."), null);
  });

  describe("with the notice on", () => {
    it("the tag and the spoken line are the spec's words", () => {
      assert.equal(GENERAL_TAG, "General information, not from verified sources");
      assert.equal(generalSpokenNotice("You may file a complaint with the police.", true), "This is general information, not from my verified sources.");
    });
    it("the spoken line follows the language of the answer", () => {
      const hindi = generalSpokenNotice("आप पुलिस में शिकायत कर सकते हैं।", true);
      assert.match(hindi, /[ऀ-ॿ]/);
      assert.match(hindi, /सामान्य जानकारी/);
    });
    it("a general turn or caption shows the tag, anything else does not", () => {
      assert.equal(showGeneralNotice(true, true), true);
      assert.equal(showGeneralNotice(false, true), false);
      assert.equal(showGeneralNotice(undefined, true), false);
    });
  });

  describe("with the notice off", () => {
    it("nothing is spoken, in English or Hindi", () => {
      assert.equal(generalSpokenNotice("You may file a complaint with the police.", false), null);
      assert.equal(generalSpokenNotice("आप पुलिस में शिकायत कर सकते हैं।", false), null);
    });
    it("a general turn or caption shows no tag", () => {
      assert.equal(showGeneralNotice(true, false), false);
      assert.equal(showGeneralNotice(false, false), false);
      assert.equal(showGeneralNotice(undefined, false), false);
    });
  });
});

/** Runs runAnswerStream over scripted events and records what the page would be told. */
async function run(events, { signal, throwAfter } = {}) {
  const log = [];
  const state = { notice: undefined, live: [] };
  await runAnswerStream({
    request: { lawyer: "criminal", question: "q", signal },
    refusalSuggestions: ["s1"],
    setLiveCitations: (c) => state.live.push(c),
    setNotice: (n) => {
      state.notice = n;
      log.push(["notice", n]);
    },
    ask: async function* () {
      for (const e of events) yield e;
      if (throwAfter) throw throwAfter;
    },
    handlers: {
      onSentence: (s, c) => log.push(["sentence", s, c]),
      onRefused: (a, o) => log.push(["refused", a, o]),
      onComplete: (c, o) => log.push(["complete", c, o]),
      onFailure: (c, o) => log.push(["failure", c, o]),
    },
  });
  return { log, state };
}

const cited = (n, text, label) => ({ type: "sentence", text, speak: text, newCitations: [{ n, text: label }] });
const plain = (text, extra = {}) => ({ type: "sentence", text, speak: text, newCitations: [], ...extra });

describe("runAnswerStream: a general answer", () => {
  it("marks every sentence and the ending as general, with no citations anywhere", async () => {
    const { log, state } = await run([plain("Keep a record.", { general: true }), plain("See a lawyer.", { general: true }), { type: "done", citations: [], general: true }]);
    assert.deepEqual(
      log.map((l) => l[0]),
      ["sentence", "sentence", "complete"],
    );
    assert.deepEqual(log[0].slice(1), [{ text: "Keep a record.", speak: "Keep a record.", general: true }, []]);
    assert.equal(log[1][1].general, true);
    assert.deepEqual(log[2].slice(1), [[], { general: true }]);
    assert.ok(state.live.every((c) => c.length === 0));
    assert.equal(state.notice, undefined);
  });

  it("never shows citations for a general answer even if some arrive with it", async () => {
    const { log } = await run([
      { ...plain("Keep a record.", { general: true }), newCitations: [{ n: 1, text: "BNS s.103" }] },
      { type: "done", citations: [{ n: 1, text: "BNS s.103" }], general: true },
    ]);
    assert.deepEqual(log[0][2], []);
    assert.deepEqual(log[1][1], []);
  });

  it("a failure partway through a general answer keeps the general mark for what was received", async () => {
    const { log } = await run([plain("Keep a record.", { general: true })], { throwAfter: new Error("boom") });
    const failure = log.find((l) => l[0] === "failure");
    assert.deepEqual(failure.slice(1), [[], { general: true }]);
  });

  it("a sourced answer is unchanged: verified citations, no general mark", async () => {
    const { log, state } = await run([cited(1, "Theft is punished [1].", "BNS s.303"), { type: "done", citations: [{ n: 1, text: "BNS s.303" }] }]);
    assert.equal(log[0][1].general, undefined);
    assert.ok(!("general" in log[0][1]));
    assert.deepEqual(log[0][2], [{ marker: 1, label: "BNS s.303", confidence: "verified" }]);
    assert.deepEqual(log[1].slice(1), [[{ marker: 1, label: "BNS s.303", confidence: "verified" }], {}]);
    assert.equal(state.notice, undefined);
  });

  it("a refusal is still a refusal, with suggestions", async () => {
    const { log } = await run([{ type: "refused", answer: "I don't have a reliable source for this." }]);
    assert.deepEqual(log, [["refused", "I don't have a reliable source for this.", { kind: "refusal", suggestions: ["s1"] }]]);
  });
});

describe("runAnswerStream: failures end with the friendly message", () => {
  const failures = {
    "an error event": [[{ type: "error", message: "model down" }], undefined],
    "the connection closing with no final event": [[plain("Half an answer.")], undefined],
    "nothing at all": [[], undefined],
    "done without a single sentence (would be blank)": [[{ type: "done", citations: [] }], undefined],
    "a timeout": [[], new AskTimeoutError(30_000)],
    "an HTTP 503": [[], new AskHttpError(503)],
    "an HTTP 500": [[], new AskHttpError(500)],
    "a network error": [[], new TypeError("Failed to fetch")],
  };
  for (const [name, [events, throwAfter]] of Object.entries(failures)) {
    it(`${name}: the page is told once, and the notice is the friendly message`, async () => {
      const { log, state } = await run(events, { throwAfter });
      assert.equal(state.notice, "Sorry, that took too long. Please try again.");
      assert.equal(state.notice, ASK_FAILED_MESSAGE);
      assert.equal(log.filter((l) => l[0] === "failure").length, 1);
      assert.equal(log.filter((l) => l[0] === "complete" || l[0] === "refused").length, 0);
      assert.equal(log.at(-1)[0], "failure"); // the last thing the page hears, so its spinner ends
    });
  }

  it("what had already arrived is handed back with the failure", async () => {
    const { log } = await run([cited(1, "Theft is punished [1].", "BNS s.303")], { throwAfter: new AskTimeoutError(1) });
    const failure = log.find((l) => l[0] === "failure");
    assert.deepEqual(failure[1], [{ marker: 1, label: "BNS s.303", confidence: "verified" }]);
  });

  it("an aborted request (new question, leaving the page) tells the page nothing and shows no message", async () => {
    const controller = new AbortController();
    controller.abort();
    const { log, state } = await run([plain("Late.")], { signal: controller.signal });
    assert.deepEqual(log, []);
    assert.equal(state.notice, undefined);
    const aborted = await run([], { signal: controller.signal, throwAfter: new DOMException("aborted", "AbortError") });
    assert.deepEqual(aborted.log, []);
  });
});

describe("askStream: timeout", () => {
  it("defaults to a limit that is long enough for a model answer and finite", () => {
    assert.ok(ASK_TIMEOUT_MS >= 15_000 && ASK_TIMEOUT_MS <= 60_000);
  });

  it("a server that never responds fails with AskTimeoutError", async () => {
    hungFetch();
    const started = Date.now();
    await assert.rejects(collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 40 })), (error) => error instanceof AskTimeoutError && error.timeoutMs === 40);
    assert.ok(Date.now() - started < 1000);
  });

  it("keep-alive comments (\": waiting\") while the backend waits for Groq reset the inactivity timer and are ignored", async () => {
    // 6 comments 30 ms apart = 180 ms of silence-free waiting, three times the 60 ms timeout, then the answer.
    streamingFetch([...Array(6).fill(": waiting\n\n").flatMap((c) => [c, 30]), sse({ type: "sentence", text: "A [1].", speak: "A.", new_citations: [{ n: 1, text: "BNS s.103" }] }), sse({ type: "done", citations: ["BNS s.103"] })]);
    const events = await collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 60 }));
    assert.deepEqual(events.map((e) => e.type), ["sentence", "done"]);
  });
  it("without keep-alives the same silence times out", async () => {
    streamingFetch([200, sse({ type: "done", citations: [] })]);
    await assert.rejects(collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 60 })), AskTimeoutError);
  });
  it("a stream that stalls after some sentences fails with AskTimeoutError, after delivering them", async () => {
    streamingFetch([sse(plain("First.")).replace('"newCitations":[]', '"new_citations":[]'), 5000]);
    const got = [];
    await assert.rejects(
      (async () => {
        for await (const e of askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 60 })) got.push(e);
      })(),
      AskTimeoutError,
    );
    assert.deepEqual(
      got.map((e) => e.type),
      ["sentence"],
    );
  });

  it("the limit is for silence, not for the whole answer: events arriving in time keep it alive", async () => {
    const s = (t) => sse({ type: "sentence", text: t, speak: t, new_citations: [] });
    streamingFetch([s("One."), 40, s("Two."), 40, s("Three."), 40, sse({ type: "done", citations: [] })]);
    const events = await collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 100 }));
    assert.deepEqual(
      events.map((e) => e.type),
      ["sentence", "sentence", "sentence", "done"],
    );
  });

  it("time the caller spends handling an event is not counted against the backend", async () => {
    const s = (t) => sse({ type: "sentence", text: t, speak: t, new_citations: [] });
    streamingFetch([s("One."), sse({ type: "done", citations: [] })]);
    const types = [];
    for await (const e of askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 40 })) {
      types.push(e.type);
      await sleep(80);
    }
    assert.deepEqual(types, ["sentence", "done"]);
  });

  it("a caller's abort is an AbortError, not a timeout", async () => {
    hungFetch();
    const controller = new AbortController();
    const pending = collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", signal: controller.signal, timeoutMs: 5000 }));
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, (error) => error.name === "AbortError" && !(error instanceof AskTimeoutError));
  });

  it("an already-aborted signal never makes a request that survives", async () => {
    hungFetch();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(collect(askStream({ lawyer: "criminal", question: "q", baseUrl: "http://backend.test", signal: controller.signal })), (e) => e.name === "AbortError");
  });

  it("end to end: a hung server ends in onFailure with the friendly message", async () => {
    hungFetch();
    const log = [];
    let notice;
    await runAnswerStream({
      request: { lawyer: "criminal", question: "q", baseUrl: "http://backend.test", timeoutMs: 30 },
      refusalSuggestions: [],
      setLiveCitations: () => {},
      setNotice: (n) => (notice = n),
      handlers: { onSentence: () => log.push("sentence"), onRefused: () => log.push("refused"), onComplete: () => log.push("complete"), onFailure: () => log.push("failure") },
    });
    assert.deepEqual(log, ["failure"]);
    assert.equal(notice, "Sorry, that took too long. Please try again.");
  });
});

describe("meta questions are answered locally and never reach the backend", () => {
  it("every spec phrase, greeting, thanks and goodbye routes to the in-app reply without a request", () => {
    globalThis.fetch = () => {
      throw new Error("the backend must not be called");
    };
    const phrases = [
      "who are you", "what are you", "what can you do", "what can you help me with", "how can you help", "introduce yourself", "tell me about yourself", "are you a real lawyer",
      "are you an AI", "how does this work", "what is your name", "aap kaun ho", "tum kya kar sakte ho", "aap kya kar sakte hain",
      "hi", "hello", "namaste", "thanks", "bye",
    ];
    for (const text of phrases) {
      const route = routeQuestion(text, "no-document");
      assert.equal(route.kind, "intro", text);
      assert.ok(buildIntro(DEMO_LAWYERS[0], route.intent, text).length > 0, text);
    }
  });

  it("a legal question that contains 'help' is sent to the backend", () => {
    assert.equal(routeQuestion("Can you help me understand if my landlord can evict me without notice?", "no-document").kind, "ask");
    assert.equal(routeQuestion("how can you help with my FIR", "no-document").kind, "ask");
  });
});
