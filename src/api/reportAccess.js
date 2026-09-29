import { apiFetch } from "./client.js";

export function getReportAccessStatus(caseId) {
  return apiFetch(`/report-access/${encodeURIComponent(caseId)}/status`);
}

export function requestReportAccess(caseId) {
  return apiFetch(`/report-access/${encodeURIComponent(caseId)}/request`, { method: "POST" });
}

export function authorizeReportAccess(caseId, auditorId) {
  return apiFetch(`/report-access/${encodeURIComponent(caseId)}/authorization`, {
    method: "POST",
    body: { auditorId },
  });
}

export function revokeReportAccess(caseId, auditorId) {
  return apiFetch(
    `/report-access/${encodeURIComponent(caseId)}/authorization/${encodeURIComponent(auditorId)}`,
    { method: "DELETE" }
  );
}

export function createReportPaymentRequest(caseId) {
  return apiFetch(`/report-access/${encodeURIComponent(caseId)}/payment`, { method: "POST" });
}

export function getReportReleaseContext(caseId, auditorId) {
  return apiFetch(
    `/report-access/${encodeURIComponent(caseId)}/release-context/${encodeURIComponent(auditorId)}`
  );
}

export function submitWrappedReportDek(caseId, auditorId, release) {
  return apiFetch(
    `/report-access/${encodeURIComponent(caseId)}/release/${encodeURIComponent(auditorId)}`,
    { method: "POST", body: release }
  );
}

export function getReleasedReport(caseId) {
  return apiFetch(`/report-access/${encodeURIComponent(caseId)}/release`);
}

export function recordReportAccess(caseId) {
  return apiFetch(`/report-access/${encodeURIComponent(caseId)}/accessed`, { method: "POST" });
}