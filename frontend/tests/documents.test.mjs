import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { askPath, askStream } from "../src/lib/askApi.ts";
import { attachFiles, getAnalysedDocuments, getSessionFiles, documentBannerTitle, isAllowedFile, removeAttachedFile, sessionForAsk, ONLY_PDF_MESSAGE } from "../src/lib/attachments.ts";
import { DocumentApiError, deleteDocument, uploadDocument } from "../src/lib/documentsApi.ts";
import { getSessionDocuments, saveSessionDocuments, DOC_TTL_MS } from "../src/lib/sessionsStore.ts";
import { splitPageTags } from "../src/lib/pageTags.ts";

const BASE = "http://backend.test";
const SCANNED = "This looks like a scanned PDF. Only text PDFs are supported.";

// The session store lives in localStorage, which node does not have.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k),
};

const realFetch = globalThis.fetch;
beforeEach(() => storage.clear());
afterEach(() => {
  globalThis.fetch = realFetch;
});

const pdf = (name = "lease.pdf", size = 2048) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UPLOADED = {
  doc_id: "d1a2b3c4",
  filename: "lease.pdf",
  pages: 4,
  analysis: {
    title: "Residential lease agreement",
    summary: "An 11-month lease of a flat in Pune.",
    key_points: ["Rent is Rs. 20,000 a month"],
    legal_issues: ["Lock-in period"],
    risks: [],
    dates_and_amounts: ["Deposit Rs. 60,000"],
  },
};

/** A fetch() that records its calls and answers each with `respond(url, init)`. */
function mockFetch(respond) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body });
    return respond(String(url), init);
  };
  return calls;
}

describe("uploadDocument", () => {
  it("posts the PDF as multipart field 'file' and returns the analysis", async () => {
    const calls = mockFetch(() => json(UPLOADED));
    const doc = await uploadDocument("sess-1", pdf(), { baseUrl: BASE });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/sessions/sess-1/documents`);
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].body instanceof FormData);
    assert.equal(calls[0].body.get("file").name, "lease.pdf");
    assert.equal(doc.doc_id, "d1a2b3c4");
    assert.equal(doc.pages, 4);
    assert.equal(doc.analysis.title, "Residential lease agreement");
    assert.deepEqual(doc.analysis.risks, []);
  });

  it("surfaces the backend's message for the scanned-PDF 422", async () => {
    mockFetch(() => json({ detail: SCANNED }, 422));
    await assert.rejects(uploadDocument("sess-1", pdf("scan.pdf"), { baseUrl: BASE }), (e) => e instanceof DocumentApiError && e.status === 422 && e.message === SCANNED);
  });

  it("falls back to a generic message when the error body has no usable detail, and for network errors", async () => {
    mockFetch(() => new Response("<html>bad gateway</html>", { status: 502 }));
    await assert.rejects(uploadDocument("s", pdf(), { baseUrl: BASE }), (e) => e.status === 502 && /error 502/.test(e.message));
    mockFetch(() => json({ detail: [{ msg: "field required" }] }, 422));
    await assert.rejects(uploadDocument("s", pdf(), { baseUrl: BASE }), (e) => e.status === 422 && /error 422/.test(e.message));
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(uploadDocument("s", pdf(), { baseUrl: BASE }), (e) => e instanceof DocumentApiError && e.status === 0 && /reach the server/.test(e.message));
  });

  it("rejects a 200 whose body is not an analysis", async () => {
    mockFetch(() => json({ ok: true }));
    await assert.rejects(uploadDocument("s", pdf(), { baseUrl: BASE }), (e) => e instanceof DocumentApiError);
  });
});

describe("attaching files (upload states)", () => {
  it("goes uploading, analysing, then attached with the analysis", async () => {
    let release;
    mockFetch(() => new Promise((resolve) => (release = () => resolve(json(UPLOADED)))));
    const { rejection, done } = attachFiles("states-1", [pdf()], { backend: true, baseUrl: BASE, analysingAfterMs: 20 });
    assert.equal(rejection, null);
    assert.deepEqual(getSessionFiles("states-1").map((f) => [f.name, f.status]), [["lease.pdf", "uploading"]]);
    await sleep(60);
    assert.equal(getSessionFiles("states-1")[0].status, "analysing");
    assert.equal(sessionForAsk("states-1"), undefined); // not analysed yet: still /ask/stream
    release();
    await done;
    const [file] = getSessionFiles("states-1");
    assert.equal(file.status, "attached");
    assert.equal(file.doc.analysis.title, "Residential lease agreement");
    assert.equal(file.error, undefined);
  });

  it("shows the scanned-PDF 422 message on the chip's file and keeps it out of the analysed documents", async () => {
    mockFetch(() => json({ detail: SCANNED }, 422));
    await attachFiles("scanned-1", [pdf("scan.pdf")], { backend: true, baseUrl: BASE, analysingAfterMs: 1000 }).done;
    const [file] = getSessionFiles("scanned-1");
    assert.equal(file.status, "error");
    assert.equal(file.error, SCANNED);
    assert.deepEqual(getAnalysedDocuments("scanned-1"), []);
    assert.equal(sessionForAsk("scanned-1"), undefined);
    assert.deepEqual(getSessionDocuments("scanned-1"), []); // nothing saved for a failed upload
  });

  it("only takes PDFs when there is a backend, and says so", async () => {
    const calls = mockFetch(() => json(UPLOADED));
    const { rejection } = attachFiles("pdfonly-1", [new File(["x"], "notes.docx"), new File(["x"], "photo.png")], { backend: true, baseUrl: BASE });
    assert.equal(rejection, ONLY_PDF_MESSAGE);
    assert.equal(ONLY_PDF_MESSAGE, "Only text PDFs are supported");
    assert.deepEqual(getSessionFiles("pdfonly-1"), []);
    assert.equal(calls.length, 0);
    assert.equal(isAllowedFile(pdf("UPPER.PDF"), true), true);
    assert.equal(isAllowedFile(new File(["x"], "a.txt"), true), false);
  });

  it("takes a PDF and turns away the rest of a mixed drop", async () => {
    mockFetch(() => json(UPLOADED));
    const { rejection, done } = attachFiles("mixed-1", [new File(["x"], "a.txt"), pdf()], { backend: true, baseUrl: BASE });
    await done;
    assert.equal(rejection, ONLY_PDF_MESSAGE);
    assert.deepEqual(getSessionFiles("mixed-1").map((f) => f.name), ["lease.pdf"]);
  });

  it("allows at most 3 documents per session with a backend; a failed upload frees its place", async () => {
    mockFetch((url) => (url.includes("/sessions/limit-1/") ? json({ detail: "boom" }, 503) : json(UPLOADED)));
    await attachFiles("limit-1", [pdf("a.pdf")], { backend: true, baseUrl: BASE }).done;
    assert.equal(getSessionFiles("limit-1")[0].status, "error");
    const { rejection } = attachFiles("limit-1", [pdf("b.pdf"), pdf("c.pdf"), pdf("d.pdf"), pdf("e.pdf")], { backend: true, baseUrl: BASE });
    assert.equal(rejection, "You can attach up to 3 documents.");
    assert.equal(getSessionFiles("limit-1").length, 4); // the failed one plus three new ones
  });

  it("keeps demo mode local: nothing is sent, any type is taken, nothing is analysed", async () => {
    const calls = mockFetch(() => json(UPLOADED));
    const { rejection, done } = attachFiles("demo-1", [new File(["x"], "notes.docx")], { backend: false });
    assert.equal(rejection, null);
    await done;
    assert.equal(calls.length, 0);
    assert.equal(getSessionFiles("demo-1")[0].status, "demo");
    assert.equal(sessionForAsk("demo-1"), undefined);
  });
});

describe("removing a document", () => {
  async function attached(sessionId) {
    mockFetch(() => json(UPLOADED));
    await attachFiles(sessionId, [pdf()], { backend: true, baseUrl: BASE }).done;
    return getSessionFiles(sessionId)[0];
  }

  it("calls DELETE /sessions/{id}/documents/{doc_id}, then drops it from the list and the saved session", async () => {
    const file = await attached("del-1");
    assert.equal(getSessionDocuments("del-1").length, 1);
    const calls = mockFetch(() => json({ deleted: true }));
    assert.equal(await removeAttachedFile(file, { baseUrl: BASE }), null);
    assert.deepEqual(calls.map((c) => [c.method, c.url]), [["DELETE", `${BASE}/sessions/del-1/documents/d1a2b3c4`]]);
    assert.deepEqual(getSessionFiles("del-1"), []);
    assert.deepEqual(getSessionDocuments("del-1"), []);
    assert.equal(sessionForAsk("del-1"), undefined); // back to /ask/stream
  });

  it("treats a 404 (already expired) as deleted", async () => {
    const file = await attached("del-2");
    mockFetch(() => json({ detail: "unknown document" }, 404));
    assert.equal(await removeAttachedFile(file, { baseUrl: BASE }), null);
    assert.deepEqual(getSessionFiles("del-2"), []);
  });

  it("keeps the document, with a message, when the server could not delete it", async () => {
    const file = await attached("del-3");
    mockFetch(() => json({ detail: "try later" }, 500));
    assert.equal(await removeAttachedFile(file, { baseUrl: BASE }), "try later");
    const [still] = getSessionFiles("del-3");
    assert.equal(still.status, "attached");
    assert.equal(still.removing, false);
    assert.equal(still.error, "try later");
    assert.equal(getSessionDocuments("del-3").length, 1);
  });

  it("deleteDocument sends nothing but the DELETE", async () => {
    const calls = mockFetch(() => json({ deleted: true }));
    await deleteDocument("a-b_1", "xyz", { baseUrl: BASE });
    assert.equal(calls[0].body, undefined);
  });
});

describe("the endpoint switch", () => {
  const done = `data: ${JSON.stringify({ type: "done", citations: [] })}\n\n`;
  const sentence = `data: ${JSON.stringify({ type: "sentence", text: "The rent is Rs. 20,000 (page 2).", speak: "The rent is Rs. 20,000.", new_citations: [] })}\n\n`;
  const sseFetch = () => mockFetch(() => new Response(sentence + done, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
  const run = async (req) => {
    const out = [];
    for await (const e of askStream({ lawyer: "property", question: "What is the rent?", baseUrl: BASE, ...req })) out.push(e);
    return out;
  };

  it("uses /ask/stream without documents and /sessions/{id}/ask/stream with them", async () => {
    const calls = sseFetch();
    await run({});
    await run({ sessionId: "sess-9" });
    assert.deepEqual(calls.map((c) => c.url), [`${BASE}/ask/stream`, `${BASE}/sessions/sess-9/ask/stream`]);
    assert.equal(askPath(), "/ask/stream");
    assert.equal(askPath("sess-9"), "/sessions/sess-9/ask/stream");
  });

  it("sends the same body to both and reads the same events, page markers included", async () => {
    const calls = sseFetch();
    const events = await run({ sessionId: "sess-9" });
    assert.deepEqual(JSON.parse(calls[0].body), { lawyer: "property", question: "What is the rent?", voice: true });
    assert.equal(events[0].type, "sentence");
    assert.equal(events[0].text, "The rent is Rs. 20,000 (page 2).");
    assert.equal(events[0].speak, "The rent is Rs. 20,000.");
    assert.equal(events[1].type, "done");
  });

  it("follows the session's documents: on after a successful upload, off after the document is removed", async () => {
    assert.equal(sessionForAsk("switch-1"), undefined);
    mockFetch(() => json(UPLOADED));
    await attachFiles("switch-1", [pdf()], { backend: true, baseUrl: BASE }).done;
    assert.equal(sessionForAsk("switch-1"), "switch-1");
    mockFetch(() => json({ deleted: true }));
    await removeAttachedFile(getSessionFiles("switch-1")[0], { baseUrl: BASE });
    assert.equal(sessionForAsk("switch-1"), undefined);
  });

  it("surfaces a non-2xx as AskHttpError on the session endpoint too", async () => {
    mockFetch(() => new Response("unavailable", { status: 503 }));
    await assert.rejects(run({ sessionId: "sess-9" }), (e) => e.name === "AskHttpError" && e.status === 503);
  });
});

describe("saving the analysis with the session", () => {
  it("stores the analysis and size, never the PDF, and brings it back after a reload", async () => {
    mockFetch(() => json(UPLOADED));
    await attachFiles("persist-1", [pdf("lease.pdf", 4096)], { backend: true, baseUrl: BASE }).done;
    const raw = storage.get("chambersai.sessionDocs");
    const saved = JSON.parse(raw);
    assert.equal(saved["persist-1"][0].analysis.title, "Residential lease agreement");
    assert.equal(saved["persist-1"][0].size, 4096);
    assert.ok(!/"file"|blob|base64/i.test(raw));

    // a fresh page load: the session's documents are in storage before anything has read them
    saveSessionDocuments("reload-1", saved["persist-1"]);
    const [file] = getSessionFiles("reload-1");
    assert.equal(file.status, "attached");
    assert.equal(file.name, "lease.pdf");
    assert.equal(file.doc.analysis.summary, UPLOADED.analysis.summary);
    assert.equal(sessionForAsk("reload-1"), "reload-1");
    assert.equal(documentBannerTitle(getAnalysedDocuments("reload-1")), "Residential lease agreement");
  });

  it("drops an analysis the backend has already expired (24 hours)", () => {
    const base = { ...UPLOADED, size: 1 };
    const now = Date.now();
    saveSessionDocuments("old-1", [
      { ...base, doc_id: "old", uploadedAt: new Date(now - DOC_TTL_MS - 1000).toISOString() },
      { ...base, doc_id: "new", uploadedAt: new Date(now - 1000).toISOString() },
    ]);
    assert.deepEqual(getSessionDocuments("old-1", now).map((d) => d.doc_id), ["new"]);
  });

  it("tolerates unreadable storage", () => {
    storage.set("chambersai.sessionDocs", "{not json");
    assert.deepEqual(getSessionDocuments("x"), []);
  });
});

describe("page tags", () => {
  it("splits '(page N)' and '(document D, page N)' out of the text", () => {
    assert.deepEqual(splitPageTags("The rent is Rs. 20,000 (page 2). The lock-in is six months (document 2, page 5)."), [
      { text: "The rent is Rs. 20,000 " },
      { text: "(page 2)", tag: "p. 2" },
      { text: ". The lock-in is six months " },
      { text: "(document 2, page 5)", tag: "doc 2 · p. 5" },
      { text: "." },
    ]);
  });

  it("leaves text without markers alone, and does not touch [n] law citations or other parentheses", () => {
    assert.deepEqual(splitPageTags("Section 106 applies [1] (see the Act)."), [{ text: "Section 106 applies [1] (see the Act)." }]);
    assert.deepEqual(splitPageTags(""), []);
  });
});

describe("routing a question (typed, spoken or picked), with and without a document", async () => {
  const { routeQuestion } = await import("../src/lib/questionRoute.ts");

  async function withDocument(sessionId) {
    mockFetch(() => json(UPLOADED));
    await attachFiles(sessionId, [pdf()], { backend: true, baseUrl: BASE }).done;
    assert.equal(sessionForAsk(sessionId), sessionId);
  }

  it("a legal question goes to /ask/stream without a document and to the session endpoint with one", async () => {
    assert.deepEqual(routeQuestion("Can my landlord evict me without notice?", "route-1"), { kind: "ask", sessionId: undefined });
    await withDocument("route-1");
    assert.deepEqual(routeQuestion("Can my landlord evict me without notice?", "route-1"), { kind: "ask", sessionId: "route-1" });
  });

  it("a greeting or help request gets the introduction on both endpoints, so a session with a document still gets it", async () => {
    await withDocument("route-2");
    for (const text of ["hi", "What can you help me with?", "what can you help me with", "how can you help me", "Namaste", "aap kya kar sakte ho", "give me some sample questions"]) {
      assert.equal(routeQuestion(text, "route-2").kind, "intro", text);
      assert.equal(routeQuestion(text, "route-without-document").kind, "intro", text);
    }
  });

  it("a help-like legal question still goes to the document endpoint", async () => {
    await withDocument("route-3");
    assert.deepEqual(routeQuestion("Can you help me understand if my landlord can evict me without notice?", "route-3"), { kind: "ask", sessionId: "route-3" });
    assert.deepEqual(routeQuestion("help with divorce papers", "route-3"), { kind: "ask", sessionId: "route-3" });
  });
});
