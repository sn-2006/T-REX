import React from "react";

export default function PlaceholderPage({ title, description, backUrl = "#/taxpayer" }) {
  return (
    <main className="dashboard-main">
      <section className="dashboard-section">
        <button
          type="button"
          className="secondary-btn"
          onClick={() => (window.location.hash = backUrl)}
        >
          ← Back to Dashboard
        </button>

        <div style={{ marginTop: "40px", padding: "40px", textAlign: "center", border: "1px dashed rgba(255,255,255,0.15)", borderRadius: "12px", background: "rgba(255,255,255,0.02)" }}>
          <h1>{title}</h1>
          <p className="muted" style={{ maxWidth: "500px", margin: "16px auto" }}>
            {description}
          </p>
          <div style={{ marginTop: "24px", color: "var(--green)", font: '500 12px "DM Mono", monospace', letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Feature in development
          </div>
        </div>
      </section>
    </main>
  );
}
