import test from "node:test";
import assert from "node:assert/strict";
import { getFriendlyBlockchainMessage } from "./friendlyMessage.js";

test("duplicate report inputs point to reused CSV/wallet/API data instead of fee churn", () => {
  const message = getFriendlyBlockchainMessage(
    new Error("execution reverted: Report already anchored")
  );

  assert.match(
    message,
    /already anchored|same CSV|same report|reused.*(CSV|wallet|API)|already used/i
  );
});

test("non-blockchain fee wording does not trigger the stale network-fee message", () => {
  const message = getFriendlyBlockchainMessage(
    new Error("CSV files are being used and the wallet/API inputs are reused; fee already accounted for")
  );

  assert.doesNotMatch(message, /network fee changed before the transaction could be submitted/i);
});

test("genuine underpriced gas errors still show the fee retry guidance", () => {
  const message = getFriendlyBlockchainMessage(
    new Error("replacement transaction underpriced")
  );

  assert.match(message, /network fee changed before the transaction could be submitted/i);
});

test("the exact stale network-fee message wins over the generic network outage wording", () => {
  const message = getFriendlyBlockchainMessage(
    new Error("The network fee changed before the transaction could be submitted. Please try again so we can calculate a fresh network fee.")
  );

  assert.match(message, /network fee changed before the transaction could be submitted/i);
  assert.doesNotMatch(message, /blockchain network could not process the transaction right now/i);
});
