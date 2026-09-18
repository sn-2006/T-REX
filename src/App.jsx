import { useEffect, useState } from "react";
import VerifyPage from "./VerifyPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import TaxpayerDashboard from "./pages/TaxpayerDashboard";
import AuditorDashboard from "./pages/AuditorDashboard";
import RegulatorDashboard from "./pages/RegulatorDashboard";
import { getSession, logout } from "./auth/auth";
import "./App.css";

const DASHBOARD_ROUTE = {
  taxpayer: "#/taxpayer",
  auditor: "#/auditor",
  regulator: "#/regulator",
};

export default function App() {
  const [route, setRoute] = useState(window.location.hash || "#/");
  const [session, setSession] = useState(() => getSession());

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function handleLoggedIn(newSession) {
    setSession(newSession);
    window.location.hash = DASHBOARD_ROUTE[newSession.role];
  }

  // Fully signs out and returns to the role-selection landing page.
  //
  // This updates `route` directly rather than only setting
  // `window.location.hash` and waiting for the async `hashchange` event:
  // the hash event doesn't fire until after this render commits, so for
  // one render `route` would still be the old dashboard path (e.g.
  // "#/taxpayer") while `session` is already null — which the router
  // below reads as "logged out, but was viewing a dashboard" and sends to
  // that role's login screen instead of the landing page. Setting both
  // React states together in the same handler keeps them in sync on the
  // very first re-render, so logout always lands on "#/".
  function handleLogout() {
    logout();
    setSession(null);
    setRoute("#/");
    window.location.hash = "#/";
  }

  // Public verification page — no session required, routes each report's
  // QR code / verify link to a real page rather than a placeholder.
  if (route.startsWith("#/verify/")) {
    return <VerifyPage hash={route.replace("#/verify/", "")} />;
  }

  if (route.startsWith("#/login/")) {
    const role = route.replace("#/login/", "");
    if (session && session.role === role) {
      window.location.hash = DASHBOARD_ROUTE[role];
      return null;
    }
    return (
      <div className="app">
        <LoginPage role={role} onLoggedIn={handleLoggedIn} />
      </div>
    );
  }

  if (route === "#/taxpayer") {
    if (!session || session.role !== "taxpayer") return <RedirectToLogin role="taxpayer" />;
    return <TaxpayerDashboard session={session} onLogout={handleLogout} />;
  }

  if (route === "#/auditor") {
    if (!session || session.role !== "auditor") return <RedirectToLogin role="auditor" />;
    return <AuditorDashboard session={session} onLogout={handleLogout} />;
  }

  if (route === "#/regulator") {
    if (!session || session.role !== "regulator") return <RedirectToLogin role="regulator" />;
    return <RegulatorDashboard session={session} onLogout={handleLogout} />;
  }

  // Default: role-selection landing page. If already signed in, send the
  // person straight to their dashboard instead of asking them to pick again.
  if (session) {
    window.location.hash = DASHBOARD_ROUTE[session.role];
    return null;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">ChainTDS</div>
      </header>
      <main className="app-main">
        <LandingPage />
      </main>
    </div>
  );
}

function RedirectToLogin({ role }) {
  useEffect(() => {
    window.location.hash = `#/login/${role}`;
  }, [role]);
  return null;
}
