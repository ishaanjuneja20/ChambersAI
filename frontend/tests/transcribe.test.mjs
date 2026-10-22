import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isJunkTranscript,
  isRecordingUsable,
  MIN_PEAK_LEVEL,
  MIN_RECORDING_MS,
  MSG_FAILED,
  MSG_NOTHING_HEARD,
  MSG_UNAVAILABLE,
  normalizeTranscript,
  resolveSpokenText,
  SILENCE_HALLUCINATIONS,
  transcribeRecording,
  TranscribeHttpError,
} from "../src/lib/transcribeApi.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let calls;
const stub = (impl) => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(init);
  };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const recording = () => new Blob([new Uint8Array(2048)], { type: "audio/webm;codecs=opus" });
const base = "http://backend.test";

describe("transcribeRecording", () => {
  it("uploads the recording as multipart field audio_file named recording.webm and returns the trimmed text", async () => {
    stub(() => json({ text: "  What happens after an arrest?  ", detected_language: "en" }));
    assert.equal(await transcribeRecording(recording(), { baseUrl: `${base}/` }), "What happens after an arrest?");
    assert.equal(calls[0].url, "http://backend.test/api/transcribe");
    assert.equal(calls[0].init.method, "POST");
    const file = calls[0].init.body.get("audio_file");
    assert.ok(file instanceof File && file.name === "recording.webm" && file.size === 2048);
    assert.equal([...calls[0].init.body.keys()].join(), "audio_file", "no language field is sent");
  });
  it("names an mp4 recording (Safari) accordingly", async () => {
    stub(() => json({ text: "x" }));
    await transcribeRecording(new Blob(["a"], { type: "audio/mp4" }), { baseUrl: base });
    assert.equal(calls[0].init.body.get("audio_file").name, "recording.mp4");
  });
  it("rejects with the status on a non-2xx response", async () => {
    stub(() => json({ detail: "Voice is not configured on this server." }, 503));
    await assert.rejects(transcribeRecording(recording(), { baseUrl: base }), (e) => e instanceof TranscribeHttpError && e.status === 503);
  });
  it("rejects on a body without text", async () => {
    stub(() => json({ detected_language: "en" }));
    await assert.rejects(transcribeRecording(recording(), { baseUrl: base }));
  });
});

describe("resolveSpokenText with a backend", () => {
  it("success: the uploaded transcript is the question, not the browser's", async () => {
    stub(() => json({ text: "What is bail?" }));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "what is bell", baseUrl: base }), { text: "What is bail?" });
  });

  it("empty text is an error, never an empty question — even if the browser guessed words", async () => {
    stub(() => json({ text: "   " }));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { error: MSG_NOTHING_HEARD });
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "something", baseUrl: base }), { error: MSG_NOTHING_HEARD });
  });

  it("503 (voice not configured): a clear error, or the browser transcript if there is one", async () => {
    stub(() => json({ detail: "Voice is not configured" }, 503));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { error: MSG_UNAVAILABLE });
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: " what is bail ", baseUrl: base }), { text: "what is bail" });
  });

  it("other HTTP failures and network errors: a clear error, or the browser transcript", async () => {
    stub(() => json({}, 500));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { error: MSG_FAILED });
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { error: MSG_FAILED });
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "what is bail", baseUrl: base }), { text: "what is bail" });
  });

  it("an empty recording is an error without calling the backend (fallback only if the browser heard words)", async () => {
    stub(() => json({ text: "x" }));
    assert.deepEqual(await resolveSpokenText({ blob: null, browserText: "", baseUrl: base }), { error: MSG_NOTHING_HEARD });
    assert.deepEqual(await resolveSpokenText({ blob: new Blob([]), browserText: "", baseUrl: base }), { error: MSG_NOTHING_HEARD });
    assert.deepEqual(await resolveSpokenText({ blob: null, browserText: "what is bail", baseUrl: base }), { text: "what is bail" });
    assert.equal(calls.length, 0);
  });

  it("an aborted upload rejects instead of falling back (the user cancelled)", async () => {
    const ctl = new AbortController();
    stub(
      (init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          queueMicrotask(() => ctl.abort());
        }),
    );
    await assert.rejects(resolveSpokenText({ blob: recording(), browserText: "what is bail", baseUrl: base, signal: ctl.signal }), (e) => e.name === "AbortError");
  });
});

describe("resolveSpokenText in demo mode (no backend)", () => {
  it("uses the browser transcript, uploads nothing, and reports silence as empty text (as before)", async () => {
    stub(() => json({ text: "from backend" }));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: " what is bail ", baseUrl: "" }), { text: "what is bail" });
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: "" }), { text: "" });
    assert.equal(calls.length, 0);
  });
});

describe("junk transcripts", () => {
  it("rejects punctuation only, too-short text and the known silence hallucinations, ignoring case and punctuation", () => {
    for (const junk of [".", "...", "?!", " , ", "", "a", "ok", "no", "Thank you.", "THANK YOU!", "thanks", "Thanks for watching!", "thank you for watching.", "You", "you.", "Bye!", "Okay.", "Uh...", "Hmm.", "So,"]) {
      assert.equal(isJunkTranscript(junk), true, JSON.stringify(junk));
    }
  });
  it("keeps a spoken greeting or help request even when it is short: it gets the lawyer's introduction", () => {
    for (const meta of ["Hi.", "Hey!", "hi", "Hello.", "Help.", "Namaste.", "नमस्ते", "Who are you?", "What can you help me with?"]) {
      assert.equal(isJunkTranscript(meta), false, JSON.stringify(meta));
    }
  });
  it("keeps real questions and short real answers", () => {
    for (const real of ["What happens after an arrest?", "yes please", "Yes, please.", "Is bail possible?", "my landlord thanks me for rent", "तलाक कैसे मिलेगा?", "Thank you for the information about bail"]) {
      assert.equal(isJunkTranscript(real), false, JSON.stringify(real));
    }
  });
  it("every listed hallucination is rejected, and the list is the one in the spec", () => {
    assert.deepEqual(SILENCE_HALLUCINATIONS, ["thank you", "thanks", "thanks for watching", "thank you for watching", "you", "bye", "okay", "ok", "uh", "hmm", "so"]);
    for (const h of SILENCE_HALLUCINATIONS) assert.equal(isJunkTranscript(`${h[0].toUpperCase()}${h.slice(1)}.`), true, h);
  });
  it("normalizes case, punctuation and spacing", () => {
    assert.equal(normalizeTranscript("  Thank   you!! "), "thank you");
  });

  it("a junk transcript from the backend is an error, nothing is sent", async () => {
    for (const text of [".", "Thank you.", "ok"]) {
      stub(() => json({ text }));
      assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { error: MSG_NOTHING_HEARD }, text);
    }
    assert.equal(MSG_NOTHING_HEARD, "Didn't catch that. Please try again.");
  });
  it("a real question and a short real answer go through", async () => {
    stub(() => json({ text: "What is the punishment for theft?" }));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { text: "What is the punishment for theft?" });
    stub(() => json({ text: "Yes please." }));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", baseUrl: base }), { text: "Yes please." });
  });
  it("a junk browser fallback is not sent either", async () => {
    stub(() => json({}, 503));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "Thank you.", baseUrl: base }), { error: MSG_NOTHING_HEARD });
  });
});

describe("recordings too short or too quiet are not uploaded", () => {
  it("isRecordingUsable", () => {
    assert.equal(isRecordingUsable({ durationMs: MIN_RECORDING_MS - 1, peakLevel: 0.5 }), false);
    assert.equal(isRecordingUsable({ durationMs: 1500, peakLevel: MIN_PEAK_LEVEL / 2 }), false);
    assert.equal(isRecordingUsable({ durationMs: 1500, peakLevel: 0.3 }), true);
    assert.equal(isRecordingUsable({}), true, "unknown measurements are not held against it");
    assert.ok(MIN_RECORDING_MS >= 600 && MIN_RECORDING_MS <= 800);
  });
  it("resolveSpokenText skips the upload entirely, even if the browser heard words", async () => {
    stub(() => json({ text: "What is bail?" }));
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "what is bail", durationMs: 300, peakLevel: 0.4, baseUrl: base }), { error: MSG_NOTHING_HEARD });
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "what is bail", durationMs: 2000, peakLevel: 0.001, baseUrl: base }), { error: MSG_NOTHING_HEARD });
    assert.equal(calls.length, 0);
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "", durationMs: 2000, peakLevel: 0.3, baseUrl: base }), { text: "What is bail?" });
    assert.equal(calls.length, 1);
  });
  it("demo mode is unchanged: no gating, browser text", async () => {
    assert.deepEqual(await resolveSpokenText({ blob: recording(), browserText: "Thank you.", durationMs: 100, peakLevel: 0, baseUrl: "" }), { text: "Thank you." });
  });
});
