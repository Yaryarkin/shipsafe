import { buildFixQueue, EFFORT_LABELS, queueByTier, sortByPriority, TIER_LABELS } from "@/lib/fix-queue";
import { assessReadiness } from "@/lib/readiness";
import { buildOwnerSummary, extractFixSteps, plainImpact, severityRows } from "@/lib/report-summary";
import { displayTarget, isBuildTarget } from "@/lib/scan-target";
import { describeDetections } from "@/lib/scanner/stack";
import { CATEGORY_LABELS, type ScanResult } from "@/lib/scanner/types";

/**
 * A clean, light document version of the report. It is invisible on screen and is the only thing
 * shown when printing or saving as PDF: no animation or decoration, and every finding
 * is fully expanded.
 */
export function PrintReport({ result }: { result: ScanResult }) {
  const host = displayTarget(result.target);
  const summary = buildOwnerSummary(result);
  const issues = sortByPriority(result.findings).filter((item) => item.severity !== "passed");
  const passed = result.findings.filter((item) => item.severity === "passed");
  const gate = assessReadiness(result);
  const queue = buildFixQueue(result.findings);

  return (
    <article id="print-report" aria-hidden="true" className="print-report hidden print:block">
      <header className="print-header">
        <p className="print-kicker">ShipSafe security report</p>
        <h1>{host}</h1>
        <p className="print-meta">
          {isBuildTarget(result.target) ? "Build scanned locally in the browser" : result.target} · {new Date(result.scannedAt).toUTCString()} · {(result.scanDurationMs / 1000).toFixed(1)}s
        </p>
      </header>

      <section className="print-score">
        <div className="print-score-value">
          {result.overallScore}
          <span>/100</span>
        </div>
        <div>
          <p className="print-grade">Grade {result.grade} · {gate.label}</p>
          <p>{gate.headline}</p>
          {result.detectedStack && result.detectedStack.length > 0 && <p className="print-muted">Detected stack: {describeDetections(result.detectedStack)}</p>}
        </div>
      </section>

      <table className="print-table">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Count</th>
            <th>Points lost</th>
          </tr>
        </thead>
        <tbody>
          {severityRows(result).map((row) => (
            <tr key={row.severity}>
              <td>{row.label}</td>
              <td>{row.count}</td>
              <td>{row.points > 0 ? `-${row.points}` : "0"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section>
        <h2>Executive summary</h2>
        <p>{summary.verdict}</p>
        <p>
          <strong>Next step:</strong> {summary.nextStep}
        </p>
      </section>

      {queue.length > 0 && (
        <section>
          <h2>Priority fix list</h2>
          {queueByTier(queue).map((group) => (
            <div key={group.tier}>
              <p>
                <strong>{TIER_LABELS[group.tier]}</strong>
              </p>
              <ul className="print-checklist">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <strong>{item.severity.toUpperCase()}</strong> {item.title} <span className="print-muted">({CATEGORY_LABELS[item.category]} · {EFFORT_LABELS[item.effort]})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2>Findings</h2>
        {issues.length === 0 && <p>No critical, warning or informational findings.</p>}
        {issues.map((item, index) => {
          const steps = extractFixSteps(item.fixPrompt);
          const snippet = item.snippets?.[0];
          return (
            <div key={item.id} className="print-finding">
              <h3>
                {index + 1}. [{item.severity.toUpperCase()}] {item.title}
              </h3>
              <p className="print-muted">{CATEGORY_LABELS[item.category]}</p>
              <p>{item.description}</p>
              <p>
                <strong>Impact:</strong> {plainImpact(item)}
              </p>
              {item.evidence && <pre>{item.evidence}</pre>}
              {steps.length > 0 && (
                <>
                  <p>
                    <strong>Remediation steps</strong>
                  </p>
                  <ol>
                    {steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </>
              )}
              {snippet && (
                <>
                  <p>
                    <strong>Fix: {snippet.label}</strong>
                  </p>
                  <pre>{snippet.code}</pre>
                </>
              )}
            </div>
          );
        })}
      </section>

      {passed.length > 0 && (
        <section>
          <h2>Passed checks</h2>
          <ul>
            {passed.map((item) => (
              <li key={item.id}>{item.title}</li>
            ))}
          </ul>
        </section>
      )}

      <footer className="print-footer">Passive configuration check only. Secrets are masked and file contents are never stored. Generated by ShipSafe.</footer>
    </article>
  );
}
