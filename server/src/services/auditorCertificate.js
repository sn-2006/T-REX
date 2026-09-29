import fs from "node:fs";
import { createHash, createPublicKey, X509Certificate } from "node:crypto";

function loadTrustConfiguration() {
  const rootPath = process.env.AUDITOR_CA_ROOT_CERT_PATH;
  const sanType = process.env.AUDITOR_CERT_IDENTITY_SAN_TYPE;
  const sanPrefix = process.env.AUDITOR_CERT_IDENTITY_SAN_PREFIX;
  if (!rootPath || !sanType || !sanPrefix) {
    throw new Error(
      "Auditor certificate validation is disabled until an external CA root and identity SAN mapping are configured."
    );
  }
  if (!["URI", "DNS", "email"].includes(sanType)) {
    throw new Error("AUDITOR_CERT_IDENTITY_SAN_TYPE must be URI, DNS, or email.");
  }

  let root;
  try {
    root = new X509Certificate(fs.readFileSync(rootPath, "utf8"));
  } catch {
    throw new Error("The configured auditor CA root certificate could not be loaded.");
  }
  if (!root.ca) throw new Error("The configured auditor trust certificate is not a CA certificate.");
  return { root, sanType, sanPrefix };
}

export function auditorCertificateTrustConfigured() {
  try {
    loadTrustConfiguration();
    return true;
  } catch {
    return false;
  }
}

export function validateAuditorCertificate({ certificatePem, publicKeySpki, keyId, auditorId }) {
  const { root, sanType, sanPrefix } = loadTrustConfiguration();
  if (typeof certificatePem !== "string" || !certificatePem.includes("BEGIN CERTIFICATE")) {
    throw new Error("A PEM-encoded auditor certificate is required.");
  }
  if (typeof publicKeySpki !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKeySpki)) {
    throw new Error("A base64-encoded auditor public key is required.");
  }

  let certificate;
  let submittedPublicKey;
  try {
    certificate = new X509Certificate(certificatePem);
    submittedPublicKey = createPublicKey({
      key: Buffer.from(publicKeySpki, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    throw new Error("The auditor certificate or public key is malformed.");
  }

  const now = Date.now();
  if (certificate.ca || certificate.validFromDate.getTime() > now || certificate.validToDate.getTime() <= now) {
    throw new Error("The auditor certificate is not a currently valid end-entity certificate.");
  }
  if (certificate.issuer !== root.subject || !certificate.verify(root.publicKey)) {
    throw new Error("The auditor certificate is not directly signed by the configured trust root.");
  }
  if (certificate.publicKey.asymmetricKeyType !== "rsa" || certificate.publicKey.asymmetricKeyDetails?.modulusLength < 3072) {
    throw new Error("Auditor certificates must contain an RSA key of at least 3072 bits.");
  }

  const expectedSan = `${sanType}:${sanPrefix}${auditorId}`;
  const sans = (certificate.subjectAltName || "").split(/,\s*/);
  if (!sans.includes(expectedSan)) {
    throw new Error("The auditor certificate URI SAN does not match the authenticated auditor identity.");
  }

  const certificateKey = certificate.publicKey.export({ type: "spki", format: "der" });
  const submittedKey = submittedPublicKey.export({ type: "spki", format: "der" });
  if (!certificateKey.equals(submittedKey)) {
    throw new Error("The certificate public key does not match the submitted auditor public key.");
  }

  const computedKeyId = createHash("sha256").update(submittedKey).digest("hex");
  if (computedKeyId !== String(keyId || "").toLowerCase()) {
    throw new Error("The auditor key identifier does not match the submitted public key.");
  }

  return {
    keyId: computedKeyId,
    publicKeySpki: submittedKey.toString("base64"),
    certificateFingerprint: createHash("sha256").update(certificate.raw).digest("hex"),
    certificateValidUntil: certificate.validToDate,
  };
}