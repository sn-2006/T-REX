import assert from "node:assert/strict";
import {
  canReturnReleasedEnvelope,
  isValidPaymentWebhookSignature,
  isReportReleaseEligible,
  paymentEventMatchesConfiguration,
  toAuditorCaseMetadata,
} from "../server/src/services/reportAccessPolicy.js";
import { createHmac } from "node:crypto";

const reportHash = "a".repeat(64);
const eligibleGrant = {
  authorizationStatus: "approved",
  paymentStatus: "verified",
  paymentRequired: true,
  certificateValid: true,
  publicKeyMatchesAuditor: true,
  reportHash,
  encryptedReportHash: reportHash,
};

assert.equal(isReportReleaseEligible(eligibleGrant), true);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, authorizationStatus: "pending" }), false);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, authorizationStatus: "revoked" }), false);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, paymentStatus: "pending" }), false);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, certificateValid: false }), false);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, publicKeyMatchesAuditor: false }), false);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, encryptedReportHash: "b".repeat(64) }), false);
assert.equal(isReportReleaseEligible({ ...eligibleGrant, paymentRequired: false, paymentStatus: "pending" }), true);
console.log("PASS: report release requires explicit approval, required verified payment, valid matching certificate key, and matching envelope hash.");

assert.equal(canReturnReleasedEnvelope({
  eligible: true,
  wrappedDek: "opaque wrapped key",
  wrappedDekKeyId: "auditor-key-1",
  auditorKeyId: "auditor-key-1",
}), true);
assert.equal(canReturnReleasedEnvelope({
  eligible: true,
  wrappedDek: "opaque wrapped key",
  wrappedDekKeyId: "old-auditor-key",
  auditorKeyId: "auditor-key-1",
}), false);
assert.equal(canReturnReleasedEnvelope({ eligible: true, wrappedDek: null, auditorKeyId: "auditor-key-1" }), false);
console.log("PASS: auditor receives only a stored DEK wrapper bound to the current validated key.");

const metadata = toAuditorCaseMetadata({
  id: reportHash,
  report_hash: reportHash,
  taxpayer_external_id: "ABCDE1234F",
  taxpayer_name: "Example Taxpayer",
  exchanges: ["Example Exchange"],
  allRows: [{ asset: "SECRET" }],
  narrative: "PRIVATE REPORT TEXT",
  discrepancies: [{ secret: "PRIVATE DISCREPANCY" }],
  insights: { secret: "PRIVATE INSIGHT" },
  reconciliation: { secret: "PRIVATE RECONCILIATION" },
  encrypted_report: { cipher: "AES-256-GCM", ciphertext: "opaque" },
  status: "pending",
});
for (const field of ["allRows", "narrative", "discrepancies", "insights", "reconciliation", "wallets"]) {
  assert.equal(Object.hasOwn(metadata, field), false, `auditor metadata must omit ${field}`);
}
assert.equal(metadata.encryptedReport.ciphertext, "opaque");
assert.equal(JSON.stringify(metadata).includes("PRIVATE REPORT TEXT"), false);
assert.equal(JSON.stringify(metadata).includes("PRIVATE DISCREPANCY"), false);
console.log("PASS: assigned/unassigned auditor case metadata omits plaintext report and transaction fields.");

const paymentBody = Buffer.from('{"provider":"test-provider","event":"payment.succeeded"}');
const paymentSecret = "test-webhook-secret";
const paymentSignature = createHmac("sha256", paymentSecret).update(paymentBody).digest("hex");
assert.equal(isValidPaymentWebhookSignature(paymentSecret, paymentBody, paymentSignature), true);
assert.equal(isValidPaymentWebhookSignature(paymentSecret, Buffer.from(`${paymentBody.toString()} `), paymentSignature), false);
assert.equal(isValidPaymentWebhookSignature("", paymentBody, paymentSignature), false);
assert.equal(paymentEventMatchesConfiguration({
  provider: "test-provider",
  expectedProvider: "test-provider",
  eventId: "event-1",
  event: "payment.succeeded",
  paymentReference: "pending-reference",
  amountMinor: 12500,
  expectedAmountMinor: 12500,
  currency: "INR",
  expectedCurrency: "INR",
}), true);
assert.equal(paymentEventMatchesConfiguration({
  provider: "test-provider",
  expectedProvider: "test-provider",
  eventId: "event-2",
  event: "payment.succeeded",
  paymentReference: "pending-reference",
  amountMinor: 1,
  expectedAmountMinor: 12500,
  currency: "INR",
  expectedCurrency: "INR",
}), false);
console.log("PASS: payment verification requires exact raw-body HMAC and configured provider, amount, and currency.");