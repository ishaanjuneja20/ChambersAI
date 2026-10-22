import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEMO_LAWYERS } from "../src/lib/demoLawyers.ts";
import { getStarterQuestions, STARTER_QUESTIONS } from "../src/lib/starterQuestions.ts";

describe("starter questions", () => {
  it("every key is a real lawyer id, with the agreed number of chips", () => {
    const ids = DEMO_LAWYERS.map((l) => l.id);
    assert.deepEqual(Object.keys(STARTER_QUESTIONS).sort(), [...ids].sort());
    const counts = Object.fromEntries(Object.entries(STARTER_QUESTIONS).map(([id, qs]) => [id, qs.length]));
    assert.deepEqual(counts, { criminal: 3, family: 3, property: 3, labour: 3, consumer: 1, constitutional: 2 });
  });
  it("an unknown or missing lawyer has no chips", () => {
    assert.deepEqual(getStarterQuestions("nobody"), []);
    assert.deepEqual(getStarterQuestions(undefined), []);
  });
});
