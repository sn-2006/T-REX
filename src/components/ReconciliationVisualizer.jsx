import { useEffect, useState } from "react";

export default function ReconciliationVisualizer({ results }) {
  const [stage, setStage] = useState(0);

  const stages = [
    "Parsing transaction data",
    "Normalizing records",
    "Matching transactions",
    "Checking TDS discrepancies",
    "Generating compliance result",
  ];

  useEffect(() => {
    if (stage >= stages.length - 1) return;

    const timer = setTimeout(() => {
      setStage((s) => s + 1);
    }, 800);

    return () => clearTimeout(timer);
  }, [stage]);

  return (
    <div className="reconciliation-visualizer">

      <h3>Reconciliation Pipeline</h3>

      <p className="reconciliation-status">
        {stages[stage]}...
      </p>

      <div className="pipeline">

        {stages.map((name, index) => (
          <div
            key={name}
            className={`pipeline-stage ${
              index <= stage ? "completed" : ""
            }`}
          >
            <div className="pipeline-circle">
              {index < stage ? "✓" : index === stage ? "●" : index + 1}
            </div>

            <span>{name}</span>

            {index < stages.length - 1 && (
              <div className="pipeline-line" />
            )}
          </div>
        ))}

      </div>

      {stage === stages.length - 1 && results && (
        <div className="reconciliation-summary">

          <div>
            <strong>{results.totalTransactions}</strong>
            <span>Transactions</span>
          </div>

          <div>
            <strong>{results.matchedTransactions}</strong>
            <span>Matched</span>
          </div>

          <div>
            <strong>{results.unmatchedTransactions}</strong>
            <span>Unmatched</span>
          </div>

          <div>
            <strong>{results.tdsDiscrepancyCount}</strong>
            <span>TDS discrepancies</span>
          </div>

        </div>
      )}

    </div>
  );
}