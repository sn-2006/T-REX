import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { sha256Hex } from "../src/utils/hash.js";
import {
  buildAuditorKeyRegistrationBody,
  decryptReleasedReport,
  decryptReportPayload,
  encryptReportPayload,
  generateClientKeyPair,
  importAuditorPublicKey,
  verifyReportIntegrity,
  wrapReportDekForAuditor,
} from "../src/utils/reportCrypto.js";
import { validateAuditorCertificate } from "../server/src/services/auditorCertificate.js";

globalThis.crypto ||= webcrypto;

const integrityPayload = {
  allRows: [{ exchange: "Example", type: "SELL", asset: "BTC", amount: 1 }],
  reconciliation: { matched: 1, warnings: [] },
  narrative: "Report narrative",
  discrepancies: [],
  insights: { highRiskCount: 0 },
};
const reportHash = await sha256Hex(integrityPayload);
const report = { id: reportHash, reportHash, ...integrityPayload };
const recipient = await generateClientKeyPair();

assert.equal(recipient.privateKey.extractable, false, "private key must not be exportable");
assert.deepEqual(recipient.privateKey.usages, ["unwrapKey"]);

const envelope = await encryptReportPayload({
  report,
  integrityPayload,
  reportHash,
  keyPair: recipient,
});
const secondEnvelope = await encryptReportPayload({
  report,
  integrityPayload,
  reportHash,
  keyPair: recipient,
});
const wrongKeyPair = await generateClientKeyPair();

assert.notEqual(envelope.iv, secondEnvelope.iv, "each encryption must use a fresh IV");
assert.equal(envelope.iv.length, 16, "96-bit IV should encode as 12 bytes");
assert.equal(JSON.stringify(envelope).includes("privateKey"), false);
assert.equal(JSON.stringify(envelope).includes("wrappedDek"), true);
assert.deepEqual(await decryptReportPayload(envelope, recipient.privateKey), report);
console.log("PASS: AES-256-GCM encryption/decryption, unique IV, RSA-OAEP DEK wrap/unwrap, and client-only key.");

const auditorPair = await generateClientKeyPair();
const importedAuditorPublicKey = await importAuditorPublicKey(auditorPair.publicKeySpki);
const release = await wrapReportDekForAuditor({
  encryptedReport: envelope,
  taxpayerPrivateKey: recipient.privateKey,
  auditorPublicKey: importedAuditorPublicKey,
  auditorKeyId: auditorPair.keyId,
});
assert.deepEqual(
  await decryptReleasedReport({
    encryptedReport: envelope,
    release,
    auditorPrivateKey: auditorPair.privateKey,
    expectedHash: reportHash,
  }),
  report
);
await assert.rejects(
  decryptReleasedReport({
    encryptedReport: envelope,
    release,
    auditorPrivateKey: wrongKeyPair?.privateKey,
    expectedHash: reportHash,
  }),
  /cannot unwrap/
);
console.log("PASS: DEK can be rewrapped for an auditor and decrypted locally with integrity verified.");

await assert.rejects(
  decryptReportPayload(envelope, wrongKeyPair.privateKey),
  /cannot unwrap/
);
console.log("PASS: wrong private key fails closed.");

const altered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -4)}AAAA` };
await assert.rejects(decryptReportPayload(altered, recipient.privateKey), /authentication failed/);
console.log("PASS: modified ciphertext fails AES-GCM authentication.");

await assert.rejects(
  decryptReportPayload({ ...envelope, wrappedDek: undefined }, recipient.privateKey),
  /metadata is missing/
);
await assert.rejects(
  decryptReportPayload(envelope, null),
  /private key is required/
);
await assert.rejects(
  encryptReportPayload({ report, integrityPayload, reportHash, keyPair: { keyId: recipient.keyId, publicKey: {} } }),
  /valid RSA-OAEP/
);
console.log("PASS: missing metadata and invalid private key fail explicitly.");

await assert.rejects(
  verifyReportIntegrity(integrityPayload, "0".repeat(64)),
  /does not match/
);
await assert.rejects(
  decryptReportPayload(envelope, recipient.privateKey, "0".repeat(64)),
  /metadata does not match/
);
assert.equal(await verifyReportIntegrity(integrityPayload, reportHash), true);
console.log("PASS: decrypted payload SHA-256 matches; altered expected hash is detected.");

const registrationBody = buildAuditorKeyRegistrationBody({
  keyPair: recipient,
  certificatePem: "-----BEGIN CERTIFICATE-----\npublic certificate\n-----END CERTIFICATE-----",
});
assert.deepEqual(Object.keys(registrationBody).sort(), ["certificatePem", "keyId", "publicKeySpki"]);
assert.equal(JSON.stringify(registrationBody).includes("privateKey"), false);
console.log("PASS: auditor registration payload contains public material only.");

const trustVariables = [
  "AUDITOR_CA_ROOT_CERT_PATH",
  "AUDITOR_CERT_IDENTITY_SAN_TYPE",
  "AUDITOR_CERT_IDENTITY_SAN_PREFIX",
];
const priorTrustValues = trustVariables.map((name) => process.env[name]);
trustVariables.forEach((name) => delete process.env[name]);
assert.throws(
  () => validateAuditorCertificate({}),
  /validation is disabled/
);
trustVariables.forEach((name, index) => {
  if (priorTrustValues[index] !== undefined) process.env[name] = priorTrustValues[index];
});
console.log("PASS: auditor certificate registration fails closed without externally configured CA trust.");