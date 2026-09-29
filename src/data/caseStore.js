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
import { getSession } from "../auth/auth.js";
import {
  decryptReportPayload,
  encryptReportPayload,
  getClientKeyPairById,
  getOrCreateClientKeyPair,
} from "../utils/reportCrypto.js";
import { buildWalletOwnershipMap } from "../utils/walletOwnership.js";

function reportIntegrityPayload(caseObj) {
  const reconciliation = { ...(caseObj.reconciliation || {}) };
  delete reconciliation.walletAnalyses;
  return {
    allRows: caseObj.allRows,
    reconciliation,
    narrative: caseObj.narrative,
    discrepancies: caseObj.discrepancies,
    insights: caseObj.insights,
  };
}

async function restoreEncryptedCase(caseObj) {
  if (!caseObj?.encryptedReport) return caseObj;
  const session = getSession();
  if (session?.role !== "taxpayer") return caseObj;

  const keyPair = await getClientKeyPairById(caseObj.encryptedReport.recipientKeyId);
  const report = await decryptReportPayload(
    caseObj.encryptedReport,
    keyPair.privateKey,
    caseObj.reportHash
  );
  return { ...caseObj, ...report };
}

export async function upsertCase(caseObj) {
  const session = getSession();
  if (session?.role !== "taxpayer" || !session.id) {
    throw new Error("A signed-in taxpayer is required to encrypt a report.");
  }

  const keyPair = await getOrCreateClientKeyPair(`taxpayer:${session.id}`);
  const report = {
    ...caseObj,
    walletOwnership:
      caseObj.walletOwnership ||
      buildWalletOwnershipMap({
        userId: session.id,
        caseWallets: caseObj.wallets || [],
        declaredWallets: caseObj.wallets || [],
        kycStatus: "verified",
      }),
  };
  const encryptedReport = await encryptReportPayload({
    report,
    integrityPayload: reportIntegrityPayload(caseObj),
    reportHash: caseObj.reportHash,
    keyPair,
  });
  const saved = await apiFetch("/cases", {
    method: "POST",
    body: {
      id: caseObj.id,
      reportHash: caseObj.reportHash,
      anchor: caseObj.anchor,
      status: caseObj.status,
      createdAt: caseObj.createdAt,
      reviewedAt: caseObj.reviewedAt,
      encryptedReport,
    },
  });
  return restoreEncryptedCase(saved);
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
  return Promise.all((await apiFetch("/cases")).map(restoreEncryptedCase));
}

export async function casesForTaxpayer() {
  return Promise.all((await apiFetch("/cases/mine")).map(restoreEncryptedCase));
}

export async function casesForAuditor() {
  return Promise.all((await apiFetch("/cases/assigned")).map(restoreEncryptedCase));
}

// Taxpayer clients waiting for any auditor to accept them.
export async function casesUnassigned() {
  return Promise.all((await apiFetch("/cases/unassigned")).map(restoreEncryptedCase));
}

// Accept an unassigned client's case — assigns it to the current auditor.
export async function acceptCase(id) {
  return restoreEncryptedCase(
    await apiFetch(`/cases/${encodeURIComponent(id)}/accept`, { method: "POST" })
  );
}

export async function getCase(id) {
  return restoreEncryptedCase(await apiFetch(`/cases/${encodeURIComponent(id)}`));
}

export function deriveStatus(insights) {
  if (insights && insights.highRiskCount > 0) return "high-risk";
  return "pending";
}
