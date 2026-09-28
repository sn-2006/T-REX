import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWalletOwnershipMap,
  resolveWalletTransferOwnership,
  resolveWalletOwnershipStatus,
} from "./walletOwnership.js";

test("verified wallet", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: ["0x1111111111111111111111111111111111111111"],
    declaredWallets: ["0x1111111111111111111111111111111111111111"],
    kycStatus: "verified",
  });

  assert.equal(map["0x1111111111111111111111111111111111111111"].status, "VERIFIED");
  assert.ok(map["0x1111111111111111111111111111111111111111"].evidence.some((e) => e.type === "USER_DECLARED"));
});

test("unknown wallet", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: ["0x2222222222222222222222222222222222222222"],
    declaredWallets: [],
    kycStatus: "verified",
  });

  assert.equal(map["0x2222222222222222222222222222222222222222"].status, "UNKNOWN");
});

test("wallet belonging to another user", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: ["0x3333333333333333333333333333333333333333"],
    declaredWallets: [],
    kycStatus: "verified",
    ownershipEvidence: [
      { type: "USER_DECLARED", wallet: "0x3333333333333333333333333333333333333333", ownerUserId: "user-2" },
    ],
  });

  assert.equal(map["0x3333333333333333333333333333333333333333"].status, "REVIEW_REQUIRED");
  assert.equal(map["0x3333333333333333333333333333333333333333"].ownerUserId, "user-2");
});

test("multiple wallets for one user", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: [
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
    ],
    declaredWallets: [
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
    ],
    kycStatus: "verified",
  });

  assert.equal(map["0x4444444444444444444444444444444444444444"].status, "VERIFIED");
  assert.equal(map["0x5555555555555555555555555555555555555555"].status, "VERIFIED");
});

test("self-transfer between verified wallets", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: [
      "0x6666666666666666666666666666666666666666",
      "0x7777777777777777777777777777777777777777",
    ],
    declaredWallets: [
      "0x6666666666666666666666666666666666666666",
      "0x7777777777777777777777777777777777777777",
    ],
    kycStatus: "verified",
  });

  const outcome = resolveWalletTransferOwnership({
    sourceWallet: "0x6666666666666666666666666666666666666666",
    destinationWallet: "0x7777777777777777777777777777777777777777",
    walletOwnership: map,
    userId: "user-1",
  });

  assert.equal(outcome.status, "SELF_TRANSFER");
  assert.equal(outcome.ownershipStatus, "VERIFIED");
  assert.equal(outcome.reason, "Both wallets are verified as belonging to the same user.");
});

test("unverified wallet", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: ["0x8888888888888888888888888888888888888888"],
    declaredWallets: [],
    kycStatus: "pending",
  });

  assert.equal(map["0x8888888888888888888888888888888888888888"].status, "REVIEW_REQUIRED");
});

test("duplicate wallet association", () => {
  const map = buildWalletOwnershipMap({
    userId: "user-1",
    caseWallets: ["0x9999999999999999999999999999999999999999"],
    declaredWallets: ["0x9999999999999999999999999999999999999999"],
    ownershipEvidence: [
      { type: "USER_DECLARED", wallet: "0x9999999999999999999999999999999999999999", ownerUserId: "user-1" },
      { type: "USER_DECLARED", wallet: "0x9999999999999999999999999999999999999999", ownerUserId: "user-1" },
    ],
    kycStatus: "verified",
  });

  assert.equal(Object.keys(map).length, 1);
  assert.equal(map["0x9999999999999999999999999999999999999999"].status, "VERIFIED");
});

test("wallet ownership status helper resolves explicit unknown vs verified state", () => {
  const verified = resolveWalletOwnershipStatus({
    wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    userId: "user-1",
    ownerUserId: "user-1",
  });
  const unknown = resolveWalletOwnershipStatus({ wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", userId: "user-1" });

  assert.equal(verified, "VERIFIED");
  assert.equal(unknown, "UNKNOWN");
});
