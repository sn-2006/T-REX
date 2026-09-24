// Thin fetch wrapper for the ChainTDS backend (see /server). Attaches the
// JWT issued at login, and normalizes error handling so callers just
// `await apiFetch(...)` and catch a single Error type.

const BASE_URL = import.meta.env?.VITE_API_BASE_URL || "/api";
const TOKEN_KEY = "chaintds_token_v1";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      "Couldn't reach the T-REX server. Please try again."
    );
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no/invalid JSON body — fall through, `data` stays null
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status}).`);
  }
  return data;
}
