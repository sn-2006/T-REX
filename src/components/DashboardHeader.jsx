import React from "react";

export default function DashboardHeader({ session, roleLabel, onLogout, children }) {
  return (
    <header className="dash-nav-wrap">
      <nav className="dash-nav">
        <div className="dash-nav-left">
          <button
            className="brand"
            onClick={() => {
              window.location.hash = "#/";
            }}
            aria-label="T-REX home"
            title="Return to T-REX Landing Page"
          >
            <span className="brand-mark">T</span>
            <span>T-REX</span>
          </button>
          <div className="dash-role-tag">
            <span>LIVE</span>
            <span>{roleLabel || session.role}</span>
          </div>
        </div>

        {children && <div className="dash-nav-center">{children}</div>}

        <div className="dash-nav-right">
          <button
            className="home-nav-link"
            onClick={() => {
              window.location.hash = "#/";
            }}
          >
            LANDING PAGE
          </button>
          <div className="dashboard-user">
            <span className="dashboard-user-name">
              {session.name || session.pan || session.id}
            </span>
            <button className="logout-btn" onClick={onLogout}>
              LOG OUT
            </button>
          </div>
        </div>
      </nav>
    </header>
  );
}
