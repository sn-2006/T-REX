// ---------------------------------------------------------------------------
// Mock authentication layer.
//
// ChainTDS is a frontend-only prototype, so there's no real backend to
// authenticate against. This module fakes just enough of one to make the
// three-role login flow demoable:
//   - Auditors and Regulators are internal roles, so they're checked
//     against a small fixed demo directory below.
//   - Taxpayers aren't pre-known to the system (anyone can be a taxpayer),
//     so a taxpayer "logs in" by identifying themselves with a PAN + name;
//     that PAN becomes their durable case identity across sessions.
//
// Session is persisted to localStorage so a refresh doesn't kick the user
// back to the login screen.
// ---------------------------------------------------------------------------

const SESSION_KEY = "chaintds_session_v1";

export const DEMO_AUDITORS = [
  { id: "AUD001", password: "auditor123", name: "Priya Nair" },
  { id: "AUD002", password: "auditor123", name: "Karan Mehta" },
];

export const DEMO_REGULATORS = [
  { id: "REG001", password: "regulator123", name: "CBDT Regulatory Desk" },
];

export function loginTaxpayer({ pan, name, password }) {
  const cleanPan = (pan || "").trim().toUpperCase();
  if (!cleanPan || cleanPan.length < 4) {
    throw new Error("Enter a valid PAN to continue.");
  }
  if (!name || !name.trim()) {
    throw new Error("Enter your name to continue.");
  }
  if (!password || password.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }

  const session = {
    role: "taxpayer",
    id: cleanPan,
    panMasked: cleanPan,
    name: name.trim(),
  };
  persistSession(session);
  return session;
}

export function loginAuditor({ id, password }) {
  const match = DEMO_AUDITORS.find(
    (a) => a.id.toLowerCase() === (id || "").trim().toLowerCase()
  );
  if (!match || match.password !== password) {
    throw new Error("Invalid auditor ID or password.");
  }
  const session = { role: "auditor", id: match.id, name: match.name };
  persistSession(session);
  return session;
}

export function loginRegulator({ id, password }) {
  const match = DEMO_REGULATORS.find(
    (r) => r.id.toLowerCase() === (id || "").trim().toLowerCase()
  );
  if (!match || match.password !== password) {
    throw new Error("Invalid regulator ID or password.");
  }
  const session = { role: "regulator", id: match.id, name: match.name };
  persistSession(session);
  return session;
}

function persistSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
}
