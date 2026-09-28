import test from "node:test";
import assert from "node:assert/strict";
import { traceSourceOfFunds } from "../../server/src/services/walletTracing.js";

const walletOwnership = {
  "0x1111111111111111111111111111111111111111": { status: "VERIFIED", ownerUserId: "user-1" },
  "0x2222222222222222222222222222222222222222": { status: "VERIFIED", ownerUserId: "user-1" },
  "0x3333333333333333333333333333333333333333": { status: "UNKNOWN", ownerUserId: null },
  "0x4444444444444444444444444444444444444444": { status: "VERIFIED", ownerUserId: "user-2" },
  "0x5555555555555555555555555555555555555555": { status: "VERIFIED", ownerUserId: "user-3" },
};

const labels = {
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": { main_entity: "Binance" },
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb": { main_entity: "Uniswap" },
  "0xcccccccccccccccccccccccccccccccccccccccc": { main_entity: "Wormhole Bridge" },
  "0xdddddddddddddddddddddddddddddddddddddddd": { main_entity: "Lido" },
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": { main_entity: "Coinbase" },
};

test("exchange source", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xexchange",
      blockNumber: 10,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "EXCHANGE");
  assert.equal(result.overallStatus, "OBSERVABLE_SOURCE_IDENTIFIED");
});

test("external wallet source", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x4444444444444444444444444444444444444444",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xexternal",
      blockNumber: 11,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "EXTERNAL_WALLET");
});

test("dex/defi source", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xdex",
      blockNumber: 12,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "DEX_DEFI");
});

test("bridge source", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0xcccccccccccccccccccccccccccccccccccccccc",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xbridge",
      blockNumber: 13,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "BRIDGE");
});

test("self-transfer", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xself",
      blockNumber: 14,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "UNKNOWN");
  assert.equal(result.incomingTransfers[0].ownershipTransferType, "SELF_TRANSFER");
  assert.equal(result.incomingTransfers[0].ownershipStatus, "VERIFIED");
  assert.equal(result.incomingTransfers[0].reviewRequired, false);
});

test("verified same-user wallets are identified as a self-transfer", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x2222222222222222222222222222222222222222",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xverified-self",
      blockNumber: 14,
    }],
    walletOwnership,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "UNKNOWN");
  assert.equal(result.incomingTransfers[0].ownershipTransferType, "SELF_TRANSFER");
  assert.equal(result.incomingTransfers[0].ownershipStatus, "VERIFIED");
  assert.equal(result.incomingTransfers[0].evidenceStatus, "VERIFIED");
  assert.equal(result.incomingTransfers[0].reviewRequired, false);
});

test("zero-address transfer is not assumed to be a mining reward", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x0000000000000000000000000000000000000000",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xairdrop",
      blockNumber: 15,
    }],
    walletOwnership,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "UNKNOWN");
  assert.equal(result.incomingTransfers[0].evidenceStatus, "REVIEW_REQUIRED");
  assert.equal(result.incomingTransfers[0].reviewRequired, true);
});

test("unknown address remains UNKNOWN and requires review", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x7777777777777777777777777777777777777777",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xunknown",
      blockNumber: 15,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "UNKNOWN");
  assert.equal(result.incomingTransfers[0].evidenceStatus, "REVIEW_REQUIRED");
  assert.equal(result.incomingTransfers[0].reviewRequired, true);
});

test("known intermediary history preserves the observed upstream source", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [
      {
        fromAddress: "0x4444444444444444444444444444444444444444",
        toAddress: "0x1111111111111111111111111111111111111111",
        hash: "0xhop-1",
        blockNumber: 20,
      },
      {
        fromAddress: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        toAddress: "0x4444444444444444444444444444444444444444",
        hash: "0xhop-2",
        blockNumber: 10,
      },
    ],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].hops.length, 1);
  assert.equal(result.incomingTransfers[0].hops[0].sourceType, "EXCHANGE");
});

test("unknown intermediary produces a partial review-required trace", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x4444444444444444444444444444444444444444",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xunknown-hop",
      blockNumber: 20,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "EXTERNAL_WALLET");
  assert.equal(result.incomingTransfers[0].evidenceStatus, "PARTIAL");
  assert.equal(result.incomingTransfers[0].reviewRequired, true);
  assert.equal(result.incomingTransfers[0].hops.length, 0);
});

test("an unresolved upstream hop remains partial even when an earlier label exists", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [
      {
        fromAddress: "0x4444444444444444444444444444444444444444",
        toAddress: "0x1111111111111111111111111111111111111111",
        hash: "0xpartial-hop-1",
        blockNumber: 20,
      },
      {
        fromAddress: "0x7777777777777777777777777777777777777777",
        toAddress: "0x4444444444444444444444444444444444444444",
        hash: "0xpartial-hop-2",
        blockNumber: 10,
      },
    ],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].evidenceStatus, "PARTIAL");
  assert.equal(result.incomingTransfers[0].reviewRequired, true);
  assert.equal(result.incomingTransfers[0].hops[0].sourceType, "UNKNOWN");
});

test("duplicate records", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [
      {
        fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toAddress: "0x1111111111111111111111111111111111111111",
        hash: "0xduplicate",
        blockNumber: 18,
      },
      {
        fromAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        toAddress: "0x1111111111111111111111111111111111111111",
        hash: "0xduplicate",
        blockNumber: 18,
      },
    ],
    walletOwnership,
    labels,
  });

  assert.equal(result.summary.totalIncoming, 1);
});

test("insufficient evidence", () => {
  const result = traceSourceOfFunds({
    walletAddress: "0x1111111111111111111111111111111111111111",
    transfers: [{
      fromAddress: "0x9999999999999999999999999999999999999999",
      toAddress: "0x1111111111111111111111111111111111111111",
      hash: "0xinsufficient",
      blockNumber: 19,
    }],
    walletOwnership,
    labels,
  });

  assert.equal(result.incomingTransfers[0].sourceType, "UNKNOWN");
  assert.equal(result.incomingTransfers[0].reviewRequired, true);
});
