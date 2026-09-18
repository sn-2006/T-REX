import { useState } from "react";
import { casesForAuditor, updateCaseStatus } from "../data/caseStore";
import DashboardHeader from "../components/DashboardHeader";
import CaseDetail from "../components/CaseDetail";

const TABS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "high-risk", label: "High risk" },
  { key: "verified", label: "Verified" },
  { key: "flagged", label: "Flagged" },
];

export default function AuditorDashboard({ session, onLogout }) {
  const [cases, setCases] = useState(() => casesForAuditor(session.id));
  const [tab, setTab] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  const filtered = tab === "all" ? cases : cases.filter((c) => c.status === tab);
  const selected = cases.find((c) => c.id === selectedId) || null;

  function refresh() {
    setCases(casesForAuditor(session.id));
  }

  function handleApprove(note) {
    if (!selected) return;
    updateCaseStatus(selected.id, "verified", note);
    refresh();
  }
  function handleFlag(note) {
    if (!selected) return;
    updateCaseStatus(selected.id, "flagged", note);
    refresh();
  }

  const counts = {
    all: cases.length,
    pending: cases.filter((c) => c.status === "pending").length,
    "high-risk": cases.filter((c) => c.status === "high-risk").length,
    verified: cases.filter((c) => c.status === "verified").length,
    flagged: cases.filter((c) => c.status === "flagged").length,
  };

  return (
    <div className="app app-wide">
      <DashboardHeader session={session} roleLabel="Auditor dashboard" onLogout={onLogout} />

      <main className="app-main">
        {!selected ? (
          <section className="card">
            <h1>Assigned taxpayer cases</h1>
            <p className="muted">
              Cases reconciled and submitted by taxpayers, assigned to you for review.
            </p>

            <div className="tab-row">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-btn ${tab === t.key ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label} <span className="tab-count">{counts[t.key]}</span>
                </button>
              ))}
            </div>

            <div className="case-list">
              {filtered.length === 0 && (
                <p className="muted">No cases in this category yet.</p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  className="case-row"
                  onClick={() => setSelectedId(c.id)}
                >
                  <div>
                    <strong>{c.taxpayerName}</strong>
                    <span className="muted small"> · PAN {c.panMasked}</span>
                    <div className="muted small">{c.exchanges.join(", ")}</div>
                  </div>
                  <div className="case-row-right">
                    {c.discrepancies.length > 0 && (
                      <span className="muted small">{c.discrepancies.length} discrepancy(ies)</span>
                    )}
                    <span className={`case-status-pill case-status-${c.status}`}>
                      {c.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <section className="card">
            <button className="link-btn" onClick={() => setSelectedId(null)}>
              ← Back to case list
            </button>
            <CaseDetail case_={selected} onApprove={handleApprove} onFlag={handleFlag} />
          </section>
        )}
      </main>
    </div>
  );
}
