import AppShell from "../components/AppShell";
import SourceBadge from "../components/SourceBadge";
import { DEMO_CASE_SUMMARY } from "../lib/demoData";

export default function CaseSummary() {
  const summary = DEMO_CASE_SUMMARY;

  return (
    <AppShell>
      <div className="case-summary-page">
        <div className="demo-banner" role="note">
          Demo only — this summary is not generated from your real conversation yet (proposed GET /sessions/{"{id}"}/summary).
        </div>
        <h1>Case summary</h1>

        <section className="card">
          <h2>Key facts</h2>
          <ul>
            {summary.keyFacts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Legal sources</h2>
          <ul className="source-list">
            {summary.legalSources.map((c, i) => (
              <li key={i}>
                <SourceBadge citation={c} />
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Dates</h2>
          <ul>
            {summary.dates.map((d, i) => (
              <li key={i}>{d.label}: {d.date}</li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Missing information</h2>
          <ul>
            {summary.missingInformation.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Next steps</h2>
          <ul>
            {summary.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
