// KYC verification, in two layers:
//
// 1. Deterministic checks that run unconditionally and are genuinely real
//    (not a placeholder): correct Aadhaar check-digit via the Verhoeff
//    algorithm (the actual algorithm UIDAI uses to generate the 12th digit
//    -- see https://en.wikipedia.org/wiki/Verhoeff_algorithm), PAN format
//    rules, a plausible age, and PAN-matches-login consistency. These
//    confirm a number is well-formed and internally consistent. They do
//    NOT confirm it belongs to a real person -- there's no publicly
//    published checksum for PAN itself, and neither the Income Tax
//    Department's PAN database nor UIDAI's Aadhaar database is queryable
//    without becoming a licensed, paying customer of a KYC-as-a-service
//    provider (see below).
//
// 2. An optional real provider check, used automatically once
//    KYC_PROVIDER_API_KEY is set: callProviderPanCheck() is where that
//    provider's actual API call goes. There's no free, keyless way to query
//    NSDL/Income-Tax-Dept or UIDAI directly -- every real PAN/Aadhaar
//    verification API is a paid, licensed intermediary (Decentro, Eko,
//    Deepvue, SignDesk, AuthBridge, Cashfree Verification, Surepass, and
//    others -- compare pricing/docs and pick one). Sign up, read THEIR API
//    reference for the exact request/response shape, and fill in the
//    fetch() call below -- nothing else in the app needs to change, since
//    evaluateKyc() below always returns the same { status, reasons } shape
//    either way.

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_REGEX = /^\d{12}$/;

export const isKycProviderConfigured = Boolean(process.env.KYC_PROVIDER_API_KEY);

// --- Verhoeff checksum (real algorithm, not a placeholder) -----------------
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffIsValid(numStr) {
  let c = 0;
  const digits = numStr.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) {
    c = D[c][P[i % 8][digits[i]]];
  }
  return c === 0;
}

function ageFromDob(dobDate) {
  const now = new Date();
  let age = now.getFullYear() - dobDate.getFullYear();
  const monthDiff = now.getMonth() - dobDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dobDate.getDate())) age -= 1;
  return age;
}

// --- Pluggable real provider slot ------------------------------------------
async function callProviderPanCheck(panNumber) {
  // Not wired up -- see the module comment above for why, and what to do.
  // This throws rather than silently returning "verified" so a
  // half-configured provider fails loudly instead of rubber-stamping KYC.
  throw new Error(
    "KYC_PROVIDER_API_KEY is set but callProviderPanCheck() in kycService.js isn't implemented " +
      "yet -- fill in your chosen provider's actual API call here."
  );
}

// --- Main entry point --------------------------------------------------
export async function evaluateKyc({ fullName, dob, idType, idNumber, panOnRecord }) {
  const reasons = [];

  if (!fullName || fullName.trim().length < 3) {
    reasons.push("Full legal name looks incomplete.");
  }

  const dobDate = new Date(dob);
  if (isNaN(dobDate.getTime()) || dobDate > new Date()) {
    reasons.push("Date of birth is invalid.");
  } else {
    const age = ageFromDob(dobDate);
    if (age < 18) reasons.push("You must be 18 or older to complete KYC.");
    else if (age > 120) reasons.push("Date of birth looks implausible -- please check it.");
  }

  const normalizedId = (idNumber || "").trim().toUpperCase();

  if (idType === "PAN") {
    if (!PAN_REGEX.test(normalizedId)) {
      reasons.push("PAN must be 10 characters in the format AAAAA9999A.");
    } else if (panOnRecord && normalizedId !== panOnRecord) {
      reasons.push("The PAN entered for KYC doesn't match the PAN you signed in with.");
    } else if (isKycProviderConfigured) {
      try {
        await callProviderPanCheck(normalizedId);
      } catch (err) {
        console.error(err);
        reasons.push(
          "Couldn't reach the KYC verification provider right now -- try again in a moment."
        );
      }
    }
  } else if (idType === "AADHAAR") {
    if (!AADHAAR_REGEX.test(normalizedId)) {
      reasons.push("Aadhaar number must be exactly 12 digits.");
    } else if (!verhoeffIsValid(normalizedId)) {
      reasons.push("That Aadhaar number fails its checksum -- double-check for a typo.");
    }
  } else {
    reasons.push("Choose a supported ID type (PAN or Aadhaar).");
  }

  return reasons.length === 0
    ? { status: "verified", reasons: [] }
    : { status: "rejected", reasons };
}
