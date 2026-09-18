// Prototype stand-in for the planned Ollama call. It builds a plain-language
// narrative from the reconciliation output using a template — no model call
// yet. When Ollama is wired in, this function's return value is what the
// local model would generate from the same structured input, so nothing
// downstream (PDF export, display) needs to change.
export function generateNarrativeReport({ tradeSummary, transferChecks, warnings }) {
  const lines = [];

  lines.push(
    `This report covers ${tradeSummary.length} asset/exchange trade groups and ${transferChecks.length} cross-platform transfers.`
  );

  for (const s of tradeSummary) {
    lines.push(
      `On ${s.exchange}, you traded ${s.totalTraded.toFixed(4)} ${s.asset} across ${s.tradeCount} trade(s) worth approximately ₹${s.totalInr.toLocaleString(
        "en-IN"
      )}. TDS was deducted on ${s.tdsDeductedCount} of ${s.tradeCount} trade(s).`
    );
  }

  if (transferChecks.length > 0) {
    lines.push("\nCross-platform transfers detected:");
    for (const tc of transferChecks) {
      const verdict =
        tc.status === "TDS_GAP"
          ? "⚠ TDS status was still pending when this transfer left the source exchange — this needs manual review."
          : "✓ TDS status was cleared before this transfer, no action needed.";
      lines.push(
        `- ${tc.amount} ${tc.asset} moved from ${tc.from} to ${tc.to} (${tc.fromDate} → ${tc.toDate}). ${verdict}`
      );
    }
  } else {
    lines.push("\nNo cross-platform transfers were detected in the uploaded data.");
  }

  if (warnings.length > 0) {
    lines.push("\nItems needing your attention:");
    for (const w of warnings) {
      lines.push(`- ${w.message}`);
    }
  } else {
    lines.push("\nNo warnings — everything reconciled cleanly.");
  }

  return lines.join("\n");
}
