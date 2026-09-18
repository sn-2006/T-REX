export function generateNarrativeReport({
  tradeSummary,
  transferChecks,
  warnings,
  unmatchedDeposits = [],
}) {
  const lines = [];

  const totalTradeGroups = tradeSummary.length;
  const totalTransfers = transferChecks.length;

  const tdsGaps = transferChecks.filter(
    (t) => t.status === "TDS_GAP"
  );

  const orphanedWithdrawals = warnings.filter(
    (w) => w.type === "ORPHANED_WITHDRAWAL"
  );
  const valuationMismatches = warnings.filter(
  (w) => w.type === "VALUATION_MISMATCH"
);

  lines.push("OVERALL ASSESSMENT");
  lines.push(
    `ChainTDS reviewed ${totalTradeGroups} asset/exchange trade groups and ${totalTransfers} cross-platform transfer(s).`
  );

  if (tdsGaps.length > 0) {
    lines.push(
      `${tdsGaps.length} transfer(s) require manual review because the source exchange showed TDS as pending at the time of transfer.`
    );
  } else {
    lines.push("No cross-platform transfers have a pending TDS status.");
  }

  const unmatchedCount =
    orphanedWithdrawals.length + unmatchedDeposits.length;

  if (unmatchedCount > 0) {
    lines.push(
      `${unmatchedCount} transaction(s) could not be matched to a corresponding record in the uploaded data.`
    );
  }

  lines.push("");
  lines.push("TRADE SUMMARY");

  for (const s of tradeSummary) {
    lines.push(
      `${s.exchange} | ${s.asset} | ${s.tradeCount} trade(s) | ` +
      `${s.totalTraded.toFixed(4)} ${s.asset} | ` +
      `INR ${s.totalInr.toLocaleString("en-IN")} | ` +
      `TDS deducted: ${s.tdsDeductedCount}/${s.tradeCount}`
    );
  }

  lines.push("");

  if (transferChecks.length > 0) {
    lines.push("TRANSFER ANALYSIS");

    for (const tc of transferChecks) {
      const status =
        tc.status === "TDS_GAP"
          ? "REVIEW REQUIRED"
          : "OK";

      lines.push(
        `${tc.asset} ${tc.amount} | ${tc.from} -> ${tc.to} | ` +
        `${tc.fromDate} -> ${tc.toDate} | ${status} | ` +
        `Confidence: ${tc.confidence}%`
      );

      if (tc.status === "TDS_GAP") {
        lines.push(
          `Action: Verify whether TDS was subsequently deducted by ${tc.from}.`
        );
      }
    }
  } else {
    lines.push("TRANSFER ANALYSIS");
    lines.push("No cross-platform transfers were detected.");
  }

  lines.push("");

  if (unmatchedCount > 0) {
    lines.push("UNMATCHED TRANSACTIONS");

    for (const w of orphanedWithdrawals) {
      lines.push(`- ${w.message}`);
    }

    for (const d of unmatchedDeposits) {
      lines.push(`- ${d.message}`);
    }
  }

  lines.push("");

  lines.push("RECOMMENDED ACTIONS");

  let actionNumber = 1;

  for (const tc of tdsGaps) {
    lines.push(
      `${actionNumber}. Verify the TDS status of the ${tc.asset} transfer from ${tc.from} to ${tc.to}.`
    );
    actionNumber++;
  }

  for (const w of orphanedWithdrawals) {
    lines.push(
      `${actionNumber}. Trace unmatched withdrawal ${w.refId} and verify whether it moved to an external wallet, another exchange, or an off-ramp.`
    );
    actionNumber++;
  }

  for (const d of unmatchedDeposits) {
    lines.push(
      `${actionNumber}. Trace unmatched deposit ${d.refId} and identify its source.`
    );
    actionNumber++;
  }
  for (const v of valuationMismatches) {
  lines.push(
    `${actionNumber}. Review valuation mismatch ${v.refId} and verify the reported consideration against the determined consideration.`
  );
  actionNumber++;
}

  if (actionNumber === 1) {
    lines.push("No immediate manual actions are required.");
  }

  return lines.join("\n");
}