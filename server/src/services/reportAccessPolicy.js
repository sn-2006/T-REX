import { createHmac, timingSafeEqual } from "node:crypto";

export function isReportReleaseEligible({
  authorizationStatus,
  paymentStatus,
  paymentRequired = true,
  certificateValid = false,
  publicKeyMatchesAuditor = false,
  reportHash,
  encryptedReportHash,
}) {
  return Boolean(
    authorizationStatus === "approved" &&
    (!paymentRequired || paymentStatus === "verified") &&
    certificateValid &&
    publicKeyMatchesAuditor &&
    /^[a-f\d]{64}$/i.test(reportHash || "") &&
    encryptedReportHash === reportHash
  );
}

export function canReturnReleasedEnvelope({ eligible, wrappedDek, wrappedDekKeyId, auditorKeyId }) {
  return Boolean(eligible && wrappedDek && wrappedDekKeyId && wrappedDekKeyId === auditorKeyId);
}

export function isValidPaymentWebhookSignature(secret, rawBody, signature) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const normalized = String(signature || "").replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return false;
  const provided = Buffer.from(normalized, "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function paymentEventMatchesConfiguration({
  provider,
  expectedProvider,
  eventId,
  event,
  paymentReference,
  amountMinor,
  expectedAmountMinor,
  currency,
  expectedCurrency,
}) {
  return Boolean(
    provider === expectedProvider && eventId && event === "payment.succeeded" &&
    paymentReference && Number(amountMinor) === expectedAmountMinor &&
    String(currency || "").toUpperCase() === String(expectedCurrency || "").toUpperCase()
  );
}

export function toAuditorCaseMetadata(row) {
  const externalId = row.taxpayer_external_id || "";
  const maskedId = externalId.length > 4
    ? `${externalId.slice(0, 2)}${"*".repeat(Math.max(0, externalId.length - 4))}${externalId.slice(-2)}`
    : "****";
  return {
    id: row.id,
    taxpayerName: row.taxpayer_name,
    panMasked: maskedId,
    exchanges: row.exchanges || [],
    reportHash: row.report_hash,
    encryptedReport: row.encrypted_report || null,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    anchor: row.anchor_tx_hash
      ? {
          network: row.anchor_network,
          txHash: row.anchor_tx_hash,
          blockNumber: row.anchor_block_number,
          timestamp: row.anchor_timestamp,
          reportHash: row.report_hash,
          verificationUrl: row.verification_url,
        }
      : null,
  };
}