// ---------------------------------------------------------------------------
// Authentication layer — now backed by the real ChainTDS API (see /server)
// instead of a mocked, frontend-only directory.
//
//   - Auditors and Regulators are internal roles: their accounts must
//     already exist in the database (created via `npm run seed` in
//     /server, or by hand) — login only, no self-registration.
//   - Taxpayers aren't pre-known to the system, so a taxpayer "logs in" by
//     identifying themselves with a PAN + name + password; the backend
//     creates that account on first login and checks the password on every
//     login after that.
//
// The JWT the server issues is stored alongside the session so every
// authenticated request (see src/api/client.js) can attach it. Session is
// also persisted to localStorage so a refresh doesn't kick the user back to
// the login screen.
// ---------------------------------------------------------------------------

import { apiFetch, setToken, clearToken } from "../api/client.js";

const SESSION_KEY = "chaintds_session_v1";

export async function loginTaxpayer({ pan, name, password, region, email }) {
  const { token, session } = await apiFetch("/auth/taxpayer", {
    method: "POST",
    body: { pan, name, password, region, email },
    auth: false,
  });
  setToken(token);
  persistSession(session);
  return session;
}

export async function loginAuditor({ id, password }) {
  const { token, session } = await apiFetch("/auth/auditor", {
    method: "POST",
    body: { id, password },
    auth: false,
  });
  setToken(token);
  persistSession(session);
  return session;
}

export async function loginRegulator({ id, password }) {
  const { token, session } = await apiFetch("/auth/regulator", {
    method: "POST",
    body: { id, password },
    auth: false,
  });
  setToken(token);
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
  clearToken();
}
