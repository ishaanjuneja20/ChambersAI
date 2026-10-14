import { useState } from "react";
import AppShell from "../components/AppShell";
import { DEMO_FACTS } from "../lib/demoData";
import type { ExtractedFact } from "../lib/contract";

export default function DocumentUpload() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [facts, setFacts] = useState<ExtractedFact[]>([]);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    // No backend endpoint exists for this yet (proposed POST /sessions/{id}/documents) — this
    // always shows the same canned extraction, regardless of the file's actual content.
    setFacts(DEMO_FACTS);
  };

  const updateFact = (id: string, text: string) => {
    setFacts((prev) => prev.map((f) => (f.id === id ? { ...f, text } : f)));
  };

  return (
    <AppShell>
      <div className="document-page">
        <div className="demo-banner" role="note">
          Demo only — document analysis is not connected to a real backend yet. Uploading does not send your file
          anywhere; it is only used to show a canned example of extracted facts.
        </div>
        <h1>Upload a document</h1>
        <p>Agreements, invoices, and notices can be analysed to extract key facts automatically.</p>

        <label className="upload-dropzone">
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => handleFile(e.target.files?.[0])} />
          {fileName ? `Selected: ${fileName}` : "Click to choose a file, or drag one here"}
        </label>

        {facts.length > 0 && (
          <div className="card">
            <h2>Extracted facts</h2>
            <p className="case-panel__demo-note">Edit anything that looks wrong. Each fact is linked to the source document it came from.</p>
            <ul className="facts-list">
              {facts.map((f) => (
                <li key={f.id} className={`facts-list__item${f.flagged ? ` facts-list__item--${f.flagged}` : ""}`}>
                  <input value={f.text} onChange={(e) => updateFact(f.id, e.target.value)} />
                  <span className="facts-list__source">from {f.sourceDocument}</span>
                  {f.flagged && <span className="facts-list__flag">{f.flagged === "missing" ? "Missing detail" : "Possibly contradictory"}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppShell>
  );
}
