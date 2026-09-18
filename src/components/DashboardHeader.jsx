export default function DashboardHeader({ session, roleLabel, onLogout, children }) {
  return (
    <header className="app-header dashboard-header">
      <div>
        <div className="brand">ChainTDS</div>
        <span className="muted small">{roleLabel}</span>
      </div>

      {children}

      <div className="dashboard-user">
        <span className="dashboard-user-name">{session.name}</span>
        <button className="secondary-btn" onClick={onLogout}>Log out</button>
      </div>
    </header>
  );
}
