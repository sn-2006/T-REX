const OWNERSHIP_STATUSES = ["VERIFIED", "UNKNOWN", "REVIEW_REQUIRED"];

function normalizeWalletAddress(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) return null;
  return normalized;
}

function dedupeEvidence(evidence = []) {
  const seen = new Set();
  return evidence.filter((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const key = JSON.stringify({
      type: entry.type || null,
      wallet: entry.wallet || null,
      ownerUserId: entry.ownerUserId || null,
      userId: entry.userId || null,
      source: entry.source || null,
      valid: entry.valid ?? null,
      signature: entry.signature || null,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function determineStatus({ wallet, userId, declaredWallets, evidence, ownerUserId, kycStatus }) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet) {
    return { status: "UNKNOWN", ownerUserId: null, reason: "Unsupported or blank wallet address." };
  }

  const walletDeclared = declaredWallets.has(normalizedWallet);
  const knownOwnerMismatch = ownerUserId && ownerUserId !== userId;
  const validSignature = evidence.some((item) => item?.type === "WALLET_SIGNATURE" && item?.valid === true);

  if (ownerUserId && ownerUserId === userId) {
    return { status: "VERIFIED", ownerUserId, reason: "The wallet is explicitly mapped to the current user." };
  }

  if (knownOwnerMismatch) {
    return { status: "REVIEW_REQUIRED", ownerUserId, reason: "The wallet is mapped to a different user and requires review." };
  }

  if (walletDeclared && userId && kycStatus === "verified") {
    return {
      status: "VERIFIED",
      ownerUserId: userId,
      reason: "The wallet was declared by the current user and their KYC is verified.",
    };
  }

  if (validSignature) {
    return { status: "VERIFIED", ownerUserId: userId || null, reason: "Wallet signature evidence confirms ownership for the current user." };
  }

  if (walletDeclared && userId && kycStatus && kycStatus !== "verified") {
    return { status: "REVIEW_REQUIRED", ownerUserId: userId, reason: "The wallet was declared by the user, but their KYC is not verified yet." };
  }

  if (userId && (kycStatus === "pending" || kycStatus === "not_submitted" || !kycStatus) && evidence.length === 0) {
    return { status: "REVIEW_REQUIRED", ownerUserId: null, reason: "Wallet ownership is not confirmed and needs review before it can be treated as self-owned." };
  }

  if (evidence.length > 0) {
    return { status: "UNKNOWN", ownerUserId: null, reason: "Some ownership evidence exists, but it is not enough to confirm the wallet." };
  }

  return { status: "UNKNOWN", ownerUserId: null, reason: "No ownership evidence is available for this wallet." };
}

export function buildWalletOwnershipMap({
  userId = null,
  caseWallets = [],
  declaredWallets = [],
  kycStatus = null,
  ownershipEvidence = [],
  exchangeWalletMappings = [],
  signatureEvidence = [],
} = {}) {
  const walletSet = new Set();
  for (const wallet of [...caseWallets, ...declaredWallets]) {
    const normalized = normalizeWalletAddress(wallet);
    if (normalized) walletSet.add(normalized);
  }

  const evidenceByWallet = new Map();
  const declaredSet = new Set((declaredWallets || []).map(normalizeWalletAddress).filter(Boolean));

  for (const item of [...(ownershipEvidence || []), ...(exchangeWalletMappings || []), ...(signatureEvidence || [])]) {
    if (!item || typeof item !== "object") continue;
    const wallet = normalizeWalletAddress(item.wallet || item.address || item.walletAddress);
    if (!wallet) continue;
    const bucket = evidenceByWallet.get(wallet) || [];
    bucket.push({
      type: item.type || item.kind || "EXCHANGE_ASSOCIATION",
      wallet,
      ownerUserId: item.ownerUserId || item.userId || null,
      userId: item.userId || null,
      source: item.source || item.mappingSource || null,
      reason: item.reason || null,
      valid: item.valid ?? null,
      signature: item.signature || item.message || null,
    });
    evidenceByWallet.set(wallet, bucket);
  }

  const result = {};
  for (const wallet of [...walletSet]) {
    const evidence = dedupeEvidence(evidenceByWallet.get(wallet) || []);
    const ownerUserId = evidence.find((item) => item?.ownerUserId != null)?.ownerUserId || null;
    const outcome = determineStatus({
      wallet,
      userId,
      declaredWallets: declaredSet,
      evidence,
      ownerUserId,
      kycStatus,
    });

    const baseEvidence = evidence.length > 0
      ? evidence
      : (declaredSet.has(wallet) && userId
        ? [{ type: "USER_DECLARED", wallet, ownerUserId: userId, source: "case_wallets", reason: "Wallet declared by the current user." }]
        : []);

    result[wallet] = {
      wallet,
      ownerUserId: outcome.ownerUserId || ownerUserId,
      status: outcome.status,
      reason: outcome.reason,
      evidence: dedupeEvidence(baseEvidence).map((item) => ({
        type: item.type,
        wallet: item.wallet,
        ownerUserId: item.ownerUserId || null,
        source: item.source || null,
        reason: item.reason || null,
        valid: item.valid ?? null,
      })),
    };
  }

  return result;
}

export function resolveWalletOwnershipStatus({
  wallet,
  userId = null,
  ownerUserId = null,
  kycStatus = null,
  evidence = [],
  declaredWallets = [],
} = {}) {
  const normalizedWallet = normalizeWalletAddress(wallet);
  if (!normalizedWallet) return "UNKNOWN";

  if (ownerUserId && ownerUserId === userId) return "VERIFIED";
  if (ownerUserId && ownerUserId !== userId) return "REVIEW_REQUIRED";
  if (declaredWallets.some((value) => normalizeWalletAddress(value) === normalizedWallet) && kycStatus === "verified") return "VERIFIED";
  if (evidence.some((item) => item?.type === "WALLET_SIGNATURE" && item?.valid === true)) return "VERIFIED";
  if (kycStatus && kycStatus !== "verified") return "REVIEW_REQUIRED";
  if (evidence.length > 0) return "UNKNOWN";
  return "UNKNOWN";
}

export function resolveWalletTransferOwnership({
  sourceWallet,
  destinationWallet,
  walletOwnership = {},
  userId = null,
} = {}) {
  const source = walletOwnership[normalizeWalletAddress(sourceWallet)] || null;
  const destination = walletOwnership[normalizeWalletAddress(destinationWallet)] || null;

  if (!source || !destination) {
    return {
      status: "UNKNOWN",
      ownershipStatus: "UNKNOWN",
      reason: "One or both wallets have no confirmed ownership record.",
    };
  }

  if (source.status === "VERIFIED" && destination.status === "VERIFIED") {
    const sameOwner = (source.ownerUserId || userId) === (destination.ownerUserId || userId);
    if (sameOwner) {
      return {
        status: "SELF_TRANSFER",
        ownershipStatus: "VERIFIED",
        reason: "Both wallets are verified as belonging to the same user.",
      };
    }
    return {
      status: "TRANSFER_BETWEEN_USERS",
      ownershipStatus: "REVIEW_REQUIRED",
      reason: "The wallets are verified but belong to different users and need review.",
    };
  }

  if (source.status === "REVIEW_REQUIRED" || destination.status === "REVIEW_REQUIRED") {
    return {
      status: "REVIEW_REQUIRED",
      ownershipStatus: "REVIEW_REQUIRED",
      reason: "At least one wallet needs verification before ownership can be determined.",
    };
  }

  return {
    status: "UNKNOWN",
    ownershipStatus: "UNKNOWN",
    reason: "Wallet ownership is not yet confirmed for this transfer.",
  };
}

export { OWNERSHIP_STATUSES };
