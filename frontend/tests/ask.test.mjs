import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AskHttpError, askStream, SseParser, toAskEvent } from "../src/lib/askApi.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

/** A fetch() that answers with `chunks` (strings) one macrotask apart, and errors the body when the request is aborted. */
function mockFetch(chunks, { status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const encoder = new TextEncoder();
    let cancelled = false;
    const body = new ReadableStream({
      async start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        for (const chunk of chunks) {
          await new Promise((r) => setTimeout(r, 1));
          if (cancelled || init.signal?.aborted) return;
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(status === 200 ? body : "unavailable", { status });
  };
  return calls;
}

const collect = async (gen) => {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe("SseParser", () => {
  it("delivers an event only once its blank line has arrived, across chunk boundaries", () => {
    const p = new SseParser();
    assert.deepEqual(p.push('data: {"a"'), []);
    assert.deepEqual(p.push(':1}\n'), []);
    assert.deepEqual(p.push('\ndata: {"b":2}\n\n'), ['{"a":1}', '{"b":2}']);
  });
  it("handles CRLF, a CR split from its LF, comments and multi-line data", () => {
    const p = new SseParser();
    assert.deepEqual(p.push(": keep-alive\r\n\r\ndata: one\r"), []);
    assert.deepEqual(p.push("\n\r\ndata: x\ndata: y\n\n"), ["one", "x\ny"]);
  });
  it("flush delivers a last event that had no blank line after it", () => {
    const p = new SseParser();
    assert.deepEqual(p.push('data: {"z":1}'), []);
    assert.deepEqual(p.flush(), ['{"z":1}']);
  });
});

describe("toAskEvent", () => {
  it("normalises the four documented events and drops anything else", () => {
    assert.deepEqual(toAskEvent({ type: "sentence", text: "A [1].", speak: "A.", new_citations: [{ n: 1, text: "HMA s.13" }] }), {
      type: "sentence",
      text: "A [1].",
      speak: "A.",
      newCitations: [{ n: 1, text: "HMA s.13" }],
    });
    assert.deepEqual(toAskEvent({ type: "done", citations: ["HMA s.13", "BNS s.103"] }), {
      type: "done",
      citations: [
        { n: 1, text: "HMA s.13" },
        { n: 2, text: "BNS s.103" },
      ],
    });
    assert.deepEqual(toAskEvent({ type: "refused", answer: "No." }), { type: "refused", answer: "No." });
    assert.deepEqual(toAskEvent({ type: "error", message: "m" }), { type: "error", message: "m" });
    assert.equal(toAskEvent({ type: "sentence" }), null);
    assert.equal(toAskEvent({ type: "ping" }), null);
    assert.equal(toAskEvent("x"), null);
  });
});

describe("askStream", () => {
  it("POSTs the contract request and yields sentences as they arrive, ending at done", async () => {
    const s1 = sse({ type: "sentence", text: "Murder is punished [1].", speak: "Murder is punished.", new_citations: [{ n: 1, text: "BNS s.103" }] });
    const s2 = sse({ type: "sentence", text: "Bail is hard [2].", speak: "Bail is hard.", new_citations: [{ n: 2, text: "BNSS s.480" }] });
    const done = sse({ type: "done", citations: ["BNS s.103", "BNSS s.480"] });
    // events are cut at arbitrary byte positions, as a real network would
    const all = s1 + s2 + done;
    const calls = mockFetch([all.slice(0, 20), all.slice(20, 90), all.slice(90, 91), all.slice(91)]);

    const events = await collect(askStream({ lawyer: "criminal", question: "What is murder?", baseUrl: "http://backend.test/" }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://backend.test/ask/stream");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(calls[0].init.body), { lawyer: "criminal", question: "What is murder?", voice: true });
    assert.deepEqual(
      events.map((e) => e.type),
      ["sentence", "sentence", "done"],
    );
    assert.equal(events[0].speak, "Murder is punished.");
    assert.deepEqual(events[1].newCitations, [{ n: 2, text: "BNSS s.480" }]);
  });

  it("passes lang through when given", async () => {
    const calls = mockFetch([sse({ type: "refused", answer: "x" })]);
    await collect(askStream({ lawyer: "family", question: "q", lang: "hi", baseUrl: "http://b" }));
    assert.equal(JSON.parse(calls[0].init.body).lang, "hi");
  });

  it("yields refused and error as the final event", async () => {
    mockFetch([sse({ type: "refused", answer: "I don't have a reliable source for this." }), sse({ type: "sentence", text: "ignored", speak: "ignored" })]);
    assert.deepEqual(await collect(askStream({ lawyer: "x", question: "q", baseUrl: "http://b" })), [{ type: "refused", answer: "I don't have a reliable source for this." }]);

    mockFetch([sse({ type: "sentence", text: "A [1].", speak: "A.", new_citations: [] }), sse({ type: "error", message: "gemini down" })]);
    const events = await collect(askStream({ lawyer: "x", question: "q", baseUrl: "http://b" }));
    assert.deepEqual(events.map((e) => e.type), ["sentence", "error"]);
  });

  it("delivers a final event that the server closed the connection on without a blank line", async () => {
    mockFetch([`data: ${JSON.stringify({ type: "done", citations: [] })}`]);
    assert.deepEqual(await collect(askStream({ lawyer: "x", question: "q", baseUrl: "http://b" })), [{ type: "done", citations: [] }]);
  });

  it("skips damaged events instead of ending the answer", async () => {
    mockFetch(["data: {not json\n\n", sse({ type: "done", citations: [] })]);
    assert.deepEqual((await collect(askStream({ lawyer: "x", question: "q", baseUrl: "http://b" }))).map((e) => e.type), ["done"]);
  });

  it("throws AskHttpError with the status for a non-2xx response (503: model unavailable)", async () => {
    mockFetch([], { status: 503 });
    await assert.rejects(collect(askStream({ lawyer: "x", question: "q", baseUrl: "http://b" })), (e) => e instanceof AskHttpError && e.status === 503);
  });

  it("aborting ends the stream with an AbortError and stops reading", async () => {
    mockFetch([sse({ type: "sentence", text: "A [1].", speak: "A.", new_citations: [] }), sse({ type: "sentence", text: "B [1].", speak: "B.", new_citations: [] }), sse({ type: "done", citations: [] })]);
    const ctl = new AbortController();
    const seen = [];
    await assert.rejects(
      (async () => {
        for await (const e of askStream({ lawyer: "x", question: "q", baseUrl: "http://b", signal: ctl.signal })) {
          seen.push(e);
          ctl.abort(); // the user sent a new question
        }
      })(),
      (e) => e.name === "AbortError",
    );
    assert.equal(seen.length, 1);
  });

  it("breaking out of the loop cancels the response body", async () => {
    let cancelled = false;
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(sse({ type: "sentence", text: "A", speak: "A", new_citations: [] })));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    for await (const e of askStream({ lawyer: "x", question: "q", baseUrl: "http://b" })) {
      assert.equal(e.type, "sentence");
      break;
    }
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(cancelled, true);
  });
});
