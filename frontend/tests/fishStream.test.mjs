// FishSpeechPlayer's incremental mode, with the audio output stubbed: a fake AudioContext on a manual clock and a
// /api/speak that the test answers by hand. Nothing is decoded or played.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LipSyncDriver } from "../src/lib/lipsync/driver.ts";
import { FishSpeechPlayer, CAPTION_JOINER } from "../src/lib/speech/fishSpeech.ts";

const real = {};
let ctx; // the fake AudioContext in use
let rafQueue;
let speakCalls; // one per /api/speak request: { body, signal, respond(durationSeconds), fail(status) }

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
    this.sources = []; // every buffer source created: { duration, startAt, stopped }
    ctx = this;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  // The fake "mp3" is base64 JSON carrying the clip's duration.
  async decodeAudioData(bytes) {
    const { d } = JSON.parse(new TextDecoder().decode(bytes));
    const sampleRate = 8000;
    const data = new Float32Array(Math.round(d * sampleRate)).fill(0.2);
    return { duration: d, sampleRate, length: data.length, getChannelData: () => data };
  }
  createBufferSource() {
    const src = {
      buffer: null,
      startAt: null,
      stopped: false,
      connect() {},
      disconnect() {},
      start(at) {
        this.startAt = at;
      },
      stop() {
        this.stopped = true;
      },
    };
    this.sources.push(src);
    return src;
  }
}

beforeEach(() => {
  real.fetch = globalThis.fetch;
  real.warn = console.warn;
  console.warn = () => {};
  rafQueue = [];
  speakCalls = [];
  globalThis.AudioContext = FakeAudioContext;
  globalThis.requestAnimationFrame = (cb) => rafQueue.push(cb);
  globalThis.cancelAnimationFrame = () => {};
  globalThis.fetch = (url, init) =>
    new Promise((resolve, reject) => {
      const call = {
        url,
        body: JSON.parse(init.body),
        signal: init.signal,
        respond: (d) =>
          resolve(new Response(JSON.stringify({ audio_base64: Buffer.from(JSON.stringify({ d })).toString("base64"), format: "mp3", timing: { source: "none", segments: [] } }), { status: 200 })),
        fail: (status) => resolve(new Response("nope", { status })),
      };
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      speakCalls.push(call);
    });
});
afterEach(() => {
  globalThis.fetch = real.fetch;
  console.warn = real.warn;
  delete globalThis.AudioContext;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

const settle = () => new Promise((r) => setTimeout(r, 5));
/** Advances the audio clock by `dt` seconds and runs one animation frame. */
function advance(dt) {
  ctx.currentTime += dt;
  const frame = rafQueue.splice(0);
  frame.forEach((cb) => cb());
}

function setup() {
  const driver = new LipSyncDriver();
  const player = new FishSpeechPlayer("http://backend.test", driver);
  const progress = [];
  let ended = 0;
  const cb = { onProgress: (n) => progress.push(n), onEnd: () => ended++ };
  return { player, driver, progress, cb, ended: () => ended };
}

const S1 = { caption: "Murder is punished with death or life imprisonment [1].", speak: "Murder is punished with death or life imprisonment." };
const S2 = { caption: "Bail is a matter of right in bailable cases [2].", speak: "Bail is a matter of right in bailable cases." };
const S2_START = S1.caption.length + CAPTION_JOINER.length;

describe("FishSpeechPlayer incremental mode", () => {
  it("requests each sentence's speak text the moment it is enqueued, and plays in arrival order even if the audio returns out of order", async () => {
    const { player, cb } = setup();
    player.begin("criminal", cb);
    player.enqueue(S1);
    player.enqueue(S2);

    assert.deepEqual(speakCalls.map((c) => c.body), [
      { text: S1.speak, lawyer_id: "criminal", lang: "en" },
      { text: S2.speak, lawyer_id: "criminal", lang: "en" },
    ]);
    assert.ok(!speakCalls[0].body.text.includes("["), "markers are never spoken");

    speakCalls[1].respond(1.5); // sentence 2's audio comes back first
    await settle();
    assert.equal(ctx.sources.length, 0, "sentence 2 waits for sentence 1");

    speakCalls[0].respond(2.5);
    await settle();
    assert.equal(ctx.sources.length, 2);
    const [a, b] = ctx.sources;
    assert.ok(a.startAt >= 0.08);
    assert.ok(Math.abs(b.startAt - (a.startAt + 2.5)) < 1e-9, "sentence 2 starts exactly when sentence 1 ends");
    player.stop();
  });

  it("reveals the caption a sentence at a time, in step with playback, and ends only after finish() and the last sentence", async () => {
    const { player, driver, progress, cb, ended } = setup();
    player.begin("criminal", cb);
    player.enqueue(S1);
    player.enqueue(S2);
    speakCalls[0].respond(2);
    speakCalls[1].respond(2);
    await settle();
    const start1 = ctx.sources[0].startAt;
    assert.equal(driver.method, "text-estimate", "this fake /api/speak sends no timestamps, so phones are placed on the audio alone");

    advance(start1 + 1); // halfway through sentence 1
    const mid = progress.at(-1);
    assert.ok(mid > 0 && mid < S1.caption.length, `mid-sentence reveal ${mid}`);
    const caption = S1.caption + CAPTION_JOINER + S2.caption;
    assert.ok(caption[mid] === " " || mid === S1.caption.length, "reveals a whole word at a time");

    advance(1); // exactly where sentence 1 ends and sentence 2 begins
    assert.ok(progress.at(-1) >= S1.caption.length && progress.at(-1) <= S2_START + 10, `at the sentence boundary: ${progress.at(-1)}`);

    advance(1); // inside sentence 2
    assert.ok(progress.at(-1) > S2_START && progress.at(-1) < caption.length);

    advance(5); // all audio has played, but the answer is not declared finished yet
    assert.equal(progress.at(-1), caption.length);
    assert.equal(ended(), 0);

    player.finish();
    advance(0.1);
    assert.equal(ended(), 1);
    assert.equal(driver.method, "idle");
    advance(1);
    assert.equal(ended(), 1, "ends once");
  });

  it("a sentence enqueued after audio has run dry still plays and keeps the caption in order", async () => {
    const { player, progress, cb, ended } = setup();
    player.begin("criminal", cb);
    player.enqueue(S1);
    speakCalls[0].respond(1);
    await settle();
    advance(ctx.sources[0].startAt + 3); // sentence 1 finished long ago
    player.enqueue(S2);
    speakCalls[1].respond(1);
    await settle();
    assert.ok(ctx.sources[1].startAt >= ctx.currentTime, "scheduled in the future, not in the past");
    advance(0.5);
    assert.ok(progress.at(-1) > S2_START);
    player.finish();
    advance(2);
    assert.equal(ended(), 1);
  });

  it("finish() with nothing enqueued ends straight away", () => {
    const { player, cb, ended } = setup();
    player.begin("criminal", cb);
    player.finish();
    advance(0.1);
    assert.equal(ended(), 1);
  });

  it("stop() aborts the requests and the audio, ends the answer once, and ignores late sentences and late audio", async () => {
    const { player, driver, cb, ended } = setup();
    player.begin("criminal", cb);
    player.enqueue(S1);
    player.enqueue(S2);
    speakCalls[0].respond(2);
    await settle();
    assert.equal(ctx.sources.length, 1);

    player.stop();
    assert.equal(ended(), 1);
    assert.equal(ctx.sources[0].stopped, true);
    assert.equal(speakCalls[1].signal.aborted, true);
    assert.equal(driver.method, "idle");

    player.enqueue(S2); // the stream was cut: nothing more is requested
    assert.equal(speakCalls.length, 2);
    speakCalls[1].respond(1);
    await settle();
    assert.equal(ctx.sources.length, 1);
    advance(5);
    assert.equal(ended(), 1);
  });

  it("begin() cuts off the answer before it (new question) and that answer's audio never plays", async () => {
    const { player, cb, ended } = setup();
    player.begin("criminal", cb);
    player.enqueue(S1);
    const first = speakCalls[0];

    const second = setup();
    player.begin("family", second.cb);
    assert.equal(ended(), 1, "the interrupted answer ended");
    assert.equal(first.signal.aborted, true);

    player.enqueue(S2);
    assert.equal(speakCalls[1].body.lawyer_id, "family");
    first.respond(1);
    speakCalls[1].respond(1);
    await settle();
    assert.equal(ctx.sources.length, 1);
    player.stop();
  });

  it("when speech fails, earlier audio keeps playing, the rest is shown as text only, and the answer still ends", async () => {
    const { player, progress, cb, ended } = setup();
    player.begin("criminal", cb);
    player.enqueue(S1);
    player.enqueue(S2);
    speakCalls[0].respond(2);
    speakCalls[1].fail(502);
    await settle();
    assert.equal(ctx.sources.length, 1, "only sentence 1 has audio");

    player.enqueue({ caption: "Third [3].", speak: "Third." });
    assert.equal(speakCalls.length, 2, "no more requests after the voice failed");
    player.finish();
    await settle();

    advance(ctx.sources[0].startAt + 1);
    assert.ok(progress.at(-1) < S1.caption.length, "sentence 2 is not shown before sentence 1 was heard");
    assert.equal(ended(), 0);
    advance(2);
    const total = S1.caption.length + S2.caption.length + "Third [3].".length + 2 * CAPTION_JOINER.length;
    assert.equal(progress.at(-1), total);
    advance(0.1);
    assert.equal(ended(), 1);
  });

  it("sends Devanagari sentences with lang hi", () => {
    const { player, cb } = setup();
    player.begin("family", cb);
    player.enqueue({ caption: "तलाक के लिए आधार हैं [1]।", speak: "तलाक के लिए आधार हैं।" });
    assert.equal(speakCalls[0].body.lang, "hi");
    player.stop();
  });
});

describe("FishSpeechPlayer.speak (unchanged full-text path)", () => {
  it("still splits, requests, schedules in order and reports progress and end", async () => {
    const { player, progress, cb, ended } = setup();
    const text = "A cognizable offence lets the police arrest without a warrant. Every arrested person must be produced before a magistrate within twenty-four hours.";
    player.speak(text, "criminal", { ...cb, onFail: () => assert.fail("no failure expected") });
    await settle();
    assert.ok(speakCalls.length >= 2);
    speakCalls.forEach((c, i) => c.respond(1 + i));
    await settle();
    assert.equal(ctx.sources.length, speakCalls.length);
    advance(ctx.sources[0].startAt + 0.5);
    assert.ok(progress.at(-1) > 0 && progress.at(-1) < text.length);
    advance(30);
    assert.equal(progress.at(-1), text.length);
    assert.equal(ended(), 1);
  });
});
