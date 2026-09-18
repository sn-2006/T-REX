import { seedDemoCases } from "./mockCases.js";

// ---------------------------------------------------------------------------
// Shared "case" store.
//
// A case is one taxpayer's finalized reconciliation report — everything an
// auditor or regulator needs to review it (rows, reconciliation output,
// discrepancies, AI insights, narrative, report hash + anchor). Taxpayers
// create cases by running a reconciliation and generating a report; auditors
// review and approve/flag them; regulators see them aggregated read-only.
//
// This is a frontend-only prototype, so "the database" is localStorage,
// seeded on first load with a handful of demo cases so the Auditor and
// Regulator dashboards aren't empty before any taxpayer has used the app.
// ---------------------------------------------------------------------------

const CASES_KEY = "chaintds_cases_v1";

function readRaw() {
  try {
    const raw = localStorage.getItem(CASES_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadCases() {
  const existing = readRaw();
  if (existing && Array.isArray(existing)) return existing;

  const seeded = seedDemoCases();
  localStorage.setItem(CASES_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveCases(cases) {
  localStorage.setItem(CASES_KEY, JSON.stringify(cases));
}

export function upsertCase(caseObj) {
  const cases = loadCases();
  const idx = cases.findIndex((c) => c.id === caseObj.id);
  if (idx >= 0) {
    cases[idx] = caseObj;
  } else {
    cases.unshift(caseObj);
  }
  saveCases(cases);
  return cases;
}

export function updateCaseStatus(id, status, reviewNote) {
  const cases = loadCases();
  const idx = cases.findIndex((c) => c.id === id);
  if (idx >= 0) {
    cases[idx] = {
      ...cases[idx],
      status,
      reviewNote: reviewNote ?? cases[idx].reviewNote ?? "",
      reviewedAt: new Date().toISOString(),
    };
    saveCases(cases);
  }
  return cases;
}

export function casesForTaxpayer(taxpayerId) {
  return loadCases().filter((c) => c.taxpayerId === taxpayerId);
}

export function casesForAuditor(auditorId) {
  return loadCases().filter((c) => c.auditorId === auditorId);
}

export function getCase(id) {
  return loadCases().find((c) => c.id === id) || null;
}

// Deterministic-ish round robin so demo auditors both get cases assigned.
const AUDITOR_POOL = ["AUD001", "AUD002"];
let assignCursor = 0;
export function nextAuditorAssignment() {
  const id = AUDITOR_POOL[assignCursor % AUDITOR_POOL.length];
  assignCursor += 1;
  return id;
}

export function deriveStatus(insights) {
  if (insights && insights.highRiskCount > 0) return "high-risk";
  return "pending";
}
