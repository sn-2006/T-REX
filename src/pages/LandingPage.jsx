const ROLES = [
  {
    role: "taxpayer",
    title: "Taxpayer",
    blurb: "Upload exchange statements, reconcile TDS, and generate an anchored report.",
  },
  {
    role: "auditor",
    title: "Auditor",
    blurb: "Review assigned taxpayer cases, investigate discrepancies, approve or flag.",
  },
  {
    role: "regulator",
    title: "Government Regulator",
    blurb: "Read-only compliance analytics across every taxpayer, exchange and case.",
  },
];

export default function LandingPage() {
  return (
    <section className="card landing-card">
      <h1>Welcome to T-REX</h1>
      <p className="muted">
        Choose how you'd like to sign in. T-REX checks whether TDS is correctly
        accounted for as crypto assets move between exchanges and wallets — the
        gap no single platform can see on its own.
      </p>

      <div className="role-grid">
        {ROLES.map((r) => (
          <a key={r.role} className="role-card" href={`#/login/${r.role}`}>
            <h3>{r.title}</h3>
            <p className="muted small">{r.blurb}</p>
            <span className="link-btn">Sign in →</span>
          </a>
        ))}
      </div>
    </section>
  );
}
