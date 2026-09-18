// ---------------------------------------------------------------------------
// Case store — now backed by the real ChainTDS API + PostgreSQL (see
// /server) instead of localStorage. A case is one taxpayer's finalized
// reconciliation report — everything an auditor or regulator needs to
// review it (rows, reconciliation output, discrepancies, AI insights,
// narrative, report hash + anchor). Taxpayers create cases by running a
// reconciliation and generating a report; auditors review and
// approve/flag them; regulators see them aggregated read-only.
//
// Every function here is now async (it makes a network call) — callers
// need to `await` them. Auditor assignment and demo seed data are now
// handled server-side (round-robin assignment on insert; seed data via
// `npm run seed` in /server), so `nextAuditorAssignment` and
// `seedDemoCases` no longer exist here.
// ---------------------------------------------------------------------------

import { apiFetch } from "../api/client.js";

export async function upsertCase(caseObj) {
  return apiFetch("/cases", { method: "POST", body: caseObj });
}

export async function updateCaseStatus(id, status, reviewNote) {
  return apiFetch(`/cases/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: { status, reviewNote },
  });
}

// All cases visible to the current role — taxpayer sees their own,
// auditor sees their assigned queue, regulator sees everything.
export async function loadCases() {
  return apiFetch("/cases");
}

export async function casesForTaxpayer() {
  return apiFetch("/cases/mine");
}

export async function casesForAuditor() {
  return apiFetch("/cases/assigned");
}

// Taxpayer clients waiting for any auditor to accept them.
export async function casesUnassigned() {
  return apiFetch("/cases/unassigned");
}

// Accept an unassigned client's case — assigns it to the current auditor.
export async function acceptCase(id) {
  return apiFetch(`/cases/${encodeURIComponent(id)}/accept`, { method: "POST" });
}

export async function getCase(id) {
  return apiFetch(`/cases/${encodeURIComponent(id)}`);
}

export function deriveStatus(insights) {
  if (insights && insights.highRiskCount > 0) return "high-risk";
  return "pending";
}
