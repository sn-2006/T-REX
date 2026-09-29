import { sha256Hex } from "./hash.js";

const DATABASE_NAME = "trex-report-keys";
const DATABASE_VERSION = 1;
const KEY_STORE = "keyPairs";
const REPORT_VERSION = 1;
const REPORT_CIPHER = "AES-256-GCM";
const KEY_WRAP = "RSA-OAEP-3072-SHA256";

function getCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable in this browser.");
  }
  return globalThis.crypto;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function databaseRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not access local key storage."));
  });
}

async function openKeyDatabase() {
  if (!globalThis.indexedDB) {
    throw new Error("Browser key storage is unavailable; report encryption cannot continue.");
  }

  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(KEY_STORE)) {
      const store = database.createObjectStore(KEY_STORE, { keyPath: "namespace" });
      store.createIndex("keyId", "keyId", { unique: true });
    }
  };
  return databaseRequest(request);
}

function transactionRequest(database, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(KEY_STORE, mode);
    const request = run(transaction.objectStore(KEY_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not access local key storage."));
    transaction.onabort = () => reject(transaction.error || new Error("Local key storage transaction failed."));
  });
}

export async function generateClientKeyPair() {
  const crypto = getCrypto();
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false,
    ["wrapKey", "unwrapKey"]
  );
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const keyId = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", publicKeySpki)));

  return {
    keyId,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeySpki: bytesToBase64(publicKeySpki),
  };
}

export async function getOrCreateClientKeyPair(namespace) {
  if (typeof namespace !== "string" || !namespace.trim()) {
    throw new Error("A local key namespace is required.");
  }

  const database = await openKeyDatabase();
  try {
    const existing = await transactionRequest(database, "readonly", (store) => store.get(namespace));
    if (existing) return existing;

    const keyPair = await generateClientKeyPair();
    const record = { namespace, ...keyPair };
    try {
      await transactionRequest(database, "readwrite", (store) => store.add(record));
    } catch (error) {
      const concurrentRecord = await transactionRequest(database, "readonly", (store) => store.get(namespace));
      if (concurrentRecord) return concurrentRecord;
      throw error;
    }
    return record;
  } finally {
    database.close();
  }
}

export async function getClientKeyPairById(keyId) {
  if (typeof keyId !== "string" || !keyId) {
    throw new Error("Encrypted report is missing its recipient key identifier.");
  }

  const database = await openKeyDatabase();
  try {
    const record = await transactionRequest(database, "readonly", (store) =>
      store.index("keyId").get(keyId)
    );
    if (!record) {
      throw new Error("This browser does not have the local key required to open this report.");
    }
    return record;
  } finally {
    database.close();
  }
}

export function buildAuditorKeyRegistrationBody({ keyPair, certificatePem }) {
  if (!keyPair?.keyId || !keyPair?.publicKeySpki || !certificatePem?.trim()) {
    throw new Error("Auditor public key, key identifier, and certificate are required.");
  }
  return {
    keyId: keyPair.keyId,
    publicKeySpki: keyPair.publicKeySpki,
    certificatePem: certificatePem.trim(),
  };
}

export async function verifyReportIntegrity(integrityPayload, expectedHash) {
  if (!integrityPayload || !/^[a-f\d]{64}$/i.test(expectedHash || "")) {
    throw new Error("Report hash metadata is missing or invalid.");
  }
  const actualHash = await sha256Hex(integrityPayload);
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("Decrypted report SHA-256 does not match the report hash.");
  }
  return true;
}

function associatedData(reportHash, recipientKeyId) {
  return new TextEncoder().encode(`T-REX report v${REPORT_VERSION}:${reportHash}:${recipientKeyId}`);
}

export async function encryptReportPayload({ report, integrityPayload, reportHash, keyPair }) {
  if (!report || !keyPair?.keyId) {
    throw new Error("Report data or recipient public key is missing.");
  }
  if (
    keyPair.publicKey?.algorithm?.name !== "RSA-OAEP" ||
    keyPair.publicKey.algorithm.modulusLength < 3072 ||
    keyPair.publicKey.algorithm.hash?.name !== "SHA-256" ||
    !keyPair.publicKey.usages.includes("wrapKey")
  ) {
    throw new Error("A valid RSA-OAEP-3072-SHA256 recipient public key is required.");
  }
  await verifyReportIntegrity(integrityPayload, reportHash);

  const crypto = getCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dek = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const plaintext = new TextEncoder().encode(JSON.stringify({ report, integrityPayload }));
  const additionalData = associatedData(reportHash, keyPair.keyId);

  const [ciphertext, wrappedDek] = await Promise.all([
    crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData, tagLength: 128 },
      dek,
      plaintext
    ),
    crypto.subtle.wrapKey("raw", dek, keyPair.publicKey, { name: "RSA-OAEP" }),
  ]);

  return {
    version: REPORT_VERSION,
    cipher: REPORT_CIPHER,
    keyWrap: KEY_WRAP,
    reportHash,
    recipientKeyId: keyPair.keyId,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    wrappedDek: bytesToBase64(new Uint8Array(wrappedDek)),
  };
}

export async function decryptReportPayload(envelope, privateKey, expectedHash = envelope?.reportHash) {
  if (
    !envelope ||
    envelope.version !== REPORT_VERSION ||
    envelope.cipher !== REPORT_CIPHER ||
    envelope.keyWrap !== KEY_WRAP ||
    !envelope.iv ||
    !envelope.ciphertext ||
    !envelope.wrappedDek ||
    !envelope.recipientKeyId ||
    !/^[a-f\d]{64}$/i.test(envelope.reportHash || "")
  ) {
    throw new Error("Encrypted report metadata is missing or unsupported.");
  }
  if (
    privateKey?.algorithm?.name !== "RSA-OAEP" ||
    privateKey.algorithm.modulusLength < 3072 ||
    privateKey.algorithm.hash?.name !== "SHA-256" ||
    !privateKey.usages.includes("unwrapKey")
  ) {
    throw new Error("A valid local RSA-OAEP private key is required to open this report.");
  }
  if (expectedHash?.toLowerCase() !== envelope.reportHash.toLowerCase()) {
    throw new Error("Encrypted report hash metadata does not match the expected report hash.");
  }

  const crypto = getCrypto();
  let dek;
  try {
    dek = await crypto.subtle.unwrapKey(
      "raw",
      base64ToBytes(envelope.wrappedDek),
      privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  } catch {
    throw new Error("This private key cannot unwrap the report encryption key.");
  }

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(envelope.iv),
        additionalData: associatedData(envelope.reportHash, envelope.recipientKeyId),
        tagLength: 128,
      },
      dek,
      base64ToBytes(envelope.ciphertext)
    );
  } catch {
    throw new Error("Encrypted report authentication failed; ciphertext may be invalid or modified.");
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Decrypted report payload is not valid JSON.");
  }
  await verifyReportIntegrity(payload.integrityPayload, expectedHash);
  return payload.report;
}

function releaseLabel(reportHash, auditorKeyId) {
  return new TextEncoder().encode(`T-REX auditor DEK release v${REPORT_VERSION}:${reportHash}:${auditorKeyId}`);
}

export async function importAuditorPublicKey(publicKeySpki) {
  if (typeof publicKeySpki !== "string" || !publicKeySpki) {
    throw new Error("The validated auditor public key is missing.");
  }
  let publicKey;
  try {
    publicKey = await getCrypto().subtle.importKey(
      "spki",
      base64ToBytes(publicKeySpki),
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["wrapKey"]
    );
  } catch {
    throw new Error("The validated auditor public key is invalid.");
  }
  if (publicKey.algorithm.modulusLength < 3072) {
    throw new Error("The auditor public key must be RSA-OAEP with at least 3072 bits.");
  }
  return publicKey;
}

export async function wrapReportDekForAuditor({ encryptedReport, taxpayerPrivateKey, auditorPublicKey, auditorKeyId }) {
  if (
    !encryptedReport?.wrappedDek ||
    !encryptedReport?.reportHash ||
    !encryptedReport?.recipientKeyId ||
    !taxpayerPrivateKey ||
    !auditorPublicKey ||
    !auditorKeyId
  ) {
    throw new Error("Report key metadata, taxpayer key, and validated auditor key are required.");
  }
  if (
    taxpayerPrivateKey.algorithm?.name !== "RSA-OAEP" ||
    taxpayerPrivateKey.algorithm.modulusLength < 3072 ||
    !taxpayerPrivateKey.usages.includes("unwrapKey")
  ) {
    throw new Error("The taxpayer browser key cannot unwrap this report DEK.");
  }
  if (
    auditorPublicKey.algorithm?.name !== "RSA-OAEP" ||
    auditorPublicKey.algorithm.modulusLength < 3072 ||
    auditorPublicKey.algorithm.hash?.name !== "SHA-256" ||
    !auditorPublicKey.usages.includes("wrapKey")
  ) {
    throw new Error("The auditor key is not a validated RSA-OAEP-3072-SHA256 public key.");
  }

  const crypto = getCrypto();
  let dek;
  try {
    dek = await crypto.subtle.unwrapKey(
      "raw",
      base64ToBytes(encryptedReport.wrappedDek),
      taxpayerPrivateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      true,
      ["wrapKey"]
    );
  } catch {
    throw new Error("The taxpayer browser key cannot unwrap this report DEK.");
  }

  const wrappedDek = await crypto.subtle.wrapKey(
    "raw",
    dek,
    auditorPublicKey,
    { name: "RSA-OAEP", label: releaseLabel(encryptedReport.reportHash, auditorKeyId) }
  );
  return {
    reportHash: encryptedReport.reportHash,
    auditorKeyId,
    wrappedDek: bytesToBase64(new Uint8Array(wrappedDek)),
  };
}

export async function decryptReleasedReport({ encryptedReport, release, auditorPrivateKey, expectedHash }) {
  if (
    !release?.wrappedDek ||
    !release?.auditorKeyId ||
    release.reportHash !== encryptedReport?.reportHash ||
    !encryptedReport?.ciphertext ||
    !encryptedReport?.iv ||
    !encryptedReport?.recipientKeyId ||
    !auditorPrivateKey
  ) {
    throw new Error("The authorized auditor DEK release is incomplete or mismatched.");
  }
  if (
    auditorPrivateKey.algorithm?.name !== "RSA-OAEP" ||
    auditorPrivateKey.algorithm.modulusLength < 3072 ||
    auditorPrivateKey.algorithm.hash?.name !== "SHA-256" ||
    !auditorPrivateKey.usages.includes("unwrapKey")
  ) {
    throw new Error("A valid local auditor private key is required to open this report.");
  }

  const crypto = getCrypto();
  let dek;
  try {
    dek = await crypto.subtle.unwrapKey(
      "raw",
      base64ToBytes(release.wrappedDek),
      auditorPrivateKey,
      { name: "RSA-OAEP", label: releaseLabel(release.reportHash, release.auditorKeyId) },
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  } catch {
    throw new Error("This auditor private key cannot unwrap the released report DEK.");
  }

  if (expectedHash?.toLowerCase() !== encryptedReport.reportHash.toLowerCase()) {
    throw new Error("Released report hash metadata does not match the expected hash.");
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(encryptedReport.iv),
        additionalData: associatedData(encryptedReport.reportHash, encryptedReport.recipientKeyId),
        tagLength: 128,
      },
      dek,
      base64ToBytes(encryptedReport.ciphertext)
    );
    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new Error("Decrypted report payload is not valid JSON.");
    }
    await verifyReportIntegrity(payload.integrityPayload, expectedHash);
    return payload.report;
  } catch (error) {
    if (error.message === "Decrypted report SHA-256 does not match the report hash." || error.message === "Decrypted report payload is not valid JSON.") {
      throw error;
    }
    throw new Error("Encrypted report authentication failed; ciphertext may be invalid or modified.");
  }
}