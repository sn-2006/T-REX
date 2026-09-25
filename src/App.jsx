import { useEffect, useState } from "react";
import VerifyPage from "./VerifyPage";
import LandingPage from "./pages/LandingPage";
import LoginPage from "./pages/LoginPage";
import TaxpayerDashboard from "./pages/TaxpayerDashboard";
import AuditorDirectory from "./pages/taxpayer/AuditorDirectory";
import AuditorProfile from "./pages/taxpayer/AuditorProfile";
import MyAuditorRequests from "./pages/taxpayer/MyAuditorRequests";
import TaxpayerConversation from "./pages/taxpayer/TaxpayerConversation";
import AuditorDashboard from "./pages/AuditorDashboard";
import RegulatorDashboard from "./pages/RegulatorDashboard";
import { getSession, logout } from "./auth/auth";
import AuditorConversation from "./pages/AuditorConversation";
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
    window.location.hash = DASHBOARD_ROUTE[newSession.role] || "#/";
  }

  function handleLogout() {
    logout();
    setSession(null);
    setRoute("#/");
    window.location.hash = "#/";
  }

  // Public verification page — no session required
  if (route.startsWith("#/verify/")) {
    return (
      <div className="site">
        <div className="grain" />
        <VerifyPage hash={route.replace("#/verify/", "")} />
      </div>
    );
  }

  if (route.startsWith("#/login/")) {
    const role = route.replace("#/login/", "");
    if (session && session.role === role) {
      window.location.hash = DASHBOARD_ROUTE[role];
      return null;
    }
    return (
      <div className="site">
        <div className="grain" />
        <LoginPage role={role} onLoggedIn={handleLoggedIn} />
      </div>
    );
  }

  if (route === "#/taxpayer/conversations") {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  return (
    <div className="site">
      <div className="grain" />
      <TaxpayerConversation />
    </div>
  );
}

if (route === "#/taxpayer/auditors") {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  return (
    <div className="site">
      <div className="grain" />
      <AuditorDirectory />
    </div>
  );
}

if (route.startsWith("#/taxpayer/auditors/")) {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  const auditorId = route.replace("#/taxpayer/auditors/", "");

  return (
    <div className="site">
      <div className="grain" />
      <AuditorProfile auditorId={auditorId} />
    </div>
  );
}

if (route === "#/taxpayer/auditor-requests") {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  return (
    <div className="site">
      <div className="grain" />
      <MyAuditorRequests />
    </div>
  );
}

if (route === "#/taxpayer/conversations") {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  return (
    <div className="site">
      <div className="grain" />
      <TaxpayerConversation />
    </div>
  );
}

  if (route === "#/taxpayer") {
    if (route === "#/taxpayer/auditors") {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  return (
    <div className="site">
      <div className="grain" />
      <AuditorDirectory session={session} />
    </div>
  );
}

if (route.startsWith("#/taxpayer/auditors/")) {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  const auditorId = route.replace("#/taxpayer/auditors/", "");

  return (
    <div className="site">
      <div className="grain" />
      <AuditorProfile auditorId={auditorId} />
    </div>
  );
}

if (route === "#/taxpayer/auditor-requests") {
  if (!session || session.role !== "taxpayer") {
    return <RedirectToLogin role="taxpayer" />;
  }

  return (
    <div className="site">
      <div className="grain" />
      <MyAuditorRequests />
    </div>
  );
}
    if (!session || session.role !== "taxpayer") return <RedirectToLogin role="taxpayer" />;
    return (
      <div className="site">
        <div className="grain" />
        <TaxpayerDashboard session={session} onLogout={handleLogout} />
      </div>
    );
  }

  if (route.startsWith("#/auditor/conversations/")) {
  if (!session || session.role !== "auditor") {
    return <RedirectToLogin role="auditor" />;
  }

  const conversationId = route.replace(
    "#/auditor/conversations/",
    ""
  );

  return (
    <div className="site">
      <div className="grain" />
      <AuditorConversation
        conversationId={conversationId}
      />
    </div>
  );
  }

  if (route === "#/auditor") {
    if (!session || session.role !== "auditor") return <RedirectToLogin role="auditor" />;
    return (
      <div className="site">
        <div className="grain" />
        <AuditorDashboard session={session} onLogout={handleLogout} />
      </div>
    );
  }

  if (route === "#/regulator") {
    if (!session || session.role !== "regulator") return <RedirectToLogin role="regulator" />;
    return (
      <div className="site">
        <div className="grain" />
        <RegulatorDashboard session={session} onLogout={handleLogout} />
      </div>
    );
  }

  // Default: Full Landing Page.
  // The landing page is visible first. The user can explore all sections
  // and click "Get Started" or select a portal to open their dashboard or login.
  return (
    <div className="site">
      <div className="grain" />
      <LandingPage />
    </div>
  );
}

function RedirectToLogin({ role }) {
  useEffect(() => {
    window.location.hash = `#/login/${role}`;
  }, [role]);
  return null;
}
