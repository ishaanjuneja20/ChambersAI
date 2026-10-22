// With VITE_API_URL set but /match missing on the backend, the assistant still works through its local demo behaviour, with no error.
// (Document upload no longer falls back: its errors are shown, see documents.test.mjs.)
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { matchLawyer, matchLawyerWithFiles } from "../src/lib/matchApi.ts";

const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
let calls;

beforeEach(() => {
  calls = [];
  // the demo behaviour waits a few hundred ms to feel like a round trip; not needed here
  globalThis.setTimeout = (fn, _ms, ...args) => realSetTimeout(fn, 0, ...args);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
});

const stub = (impl) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl();
  };
};
const notFound = () => new Response('{"detail":"Not Found"}', { status: 404 });

describe("POST /match falls back to the keyword matcher", () => {
  for (const [name, impl] of [
    ["404", notFound],
    ["500", () => new Response("boom", { status: 500 })],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 200 without lawyer_id", () => new Response("{}", { status: 200 })],
  ]) {
    it(`text only, on ${name}`, async () => {
      stub(impl);
      const result = await matchLawyer("My landlord is threatening eviction");
      assert.equal(calls[0].url, "http://backend.test/match", "the backend is tried first");
      assert.equal(result.lawyerId, "property");
      assert.match(result.reason, /eviction|landlord/);
    });
  }

  it("with files, on 404 — the file names are matched too", async () => {
    stub(notFound);
    const file = new File(["x"], "rent-agreement.pdf", { type: "application/pdf" });
    const result = await matchLawyerWithFiles({ text: "", files: [file] });
    assert.equal(calls[0].url, "http://backend.test/match");
    assert.ok(calls[0].init.body instanceof FormData);
    assert.equal(result.lawyerId, "property");
    assert.match(result.reason, /Your documents mention/);
  });

  it("with files, on a network error", async () => {
    stub(() => Promise.reject(new TypeError("Failed to fetch")));
    const result = await matchLawyerWithFiles({ text: "My employer withheld my salary", files: [] });
    assert.equal(result.lawyerId, "labour");
  });

  it("uses the backend's answer when it has one", async () => {
    stub(() => new Response(JSON.stringify({ lawyer_id: "family", reason: "from the backend" }), { status: 200 }));
    assert.deepEqual(await matchLawyer("anything"), { lawyerId: "family", reason: "from the backend" });
  });
});
