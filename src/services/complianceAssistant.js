import { askLlm, isLlmConfigured } from "./llmClient.js";

// ---------------------------------------------------------------------------
// ChainTDS Compliance Explainability & Investigation Assistant.
//
// Architecture rule enforced throughout this file:
//   The rule engine (utils/reconcile.js, utils/tdsDiscrepancy.js) decides
//   compliance. This file only EXPLAINS what the rule engine already
//   decided. It never computes a tax figure, a TDS amount, a match, or a
//   confidence score — those all arrive pre-computed inside `evidence`.
//
// Every exported function here follows the same three-step shape:
//   1. Check the evidence is actually sufficient — if not, return the
//      fixed "insufficient evidence" response without ever calling an LLM.
//   2. Try the LLM, constrained to the evidence via the system prompt.
//   3. If the LLM isn't configured or the call fails for any reason
//      (model not running, network error, timeout), fall back to a
//      deterministic template built directly from the same evidence, so
//      the UI never dead-ends just because Ollama isn't running.
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are the ChainTDS Compliance Explainability Assistant.

Your role is to explain compliance results produced by the ChainTDS deterministic compliance engine.

You do not calculate taxes, calculate TDS, decide whether a transaction is taxable, or override compliance rules.

Use only the structured transaction evidence, reconciliation results, rule-engine outputs and report data provided to you.

For every explanation:

1. Clearly state what was detected.
2. Explain the evidence behind it.
3. Identify the records involved.
4. State the confidence supplied by the reconciliation engine.
5. Explain what the user should verify next.

Never invent transactions, amounts, rules, evidence, confidence scores or regulatory conclusions.

If the provided evidence is insufficient, explicitly state that there is insufficient evidence and recommend manual verification.

Your objective is to make ChainTDS compliance results understandable, traceable and auditable to a taxpayer, accountant or auditor.`;

const INSUFFICIENT_EVIDENCE = "Insufficient evidence to determine the cause. Manual verification is recommended.";

function confidenceTier(score) {
  if (score === null || score === undefined) return null;
  if (score >= 90) return { emoji: "🟢", label: "High confidence" };
  if (score >= 60) return { emoji: "🟡", label: "Medium confidence" };
  return { emoji: "🔴", label: "Low confidence" };
}

function inr(n) {
  return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// Every evidence packet built by evidenceBuilder.js is inherently
// "sufficient" — it's built from real ledger rows. The one case that
// genuinely warrants the spec's insufficient-evidence fallback is a
// transaction investigation where the source row itself couldn't be found
// (evidence.asset/quantity end up null).
function hasSufficientEvidence(evidence) {
  if (!evidence) return false;
  if ("asset" in evidence && evidence.asset === null && "sourceExchange" in evidence) return false;
  return true;
}

// ---- 1. "Why is this a discrepancy?" ---------------------------------------
export async function explainDiscrepancy(evidence) {
  const evidenceUsed = [
    `Transaction ${evidence.transactionId}`,
    ...evidence.matchingTransactions.slice(0, 5).map((m) => `Matching transaction ${m.transactionId} (${m.exchange})`),
    `Rule: ${evidence.ruleTriggered}`,
    evidence.transferConfidence !== null ? `Transfer confidence: ${evidence.transferConfidence}%` : null,
  ].filter(Boolean);

  if (!hasSufficientEvidence(evidence)) {
    return { explanation: INSUFFICIENT_EVIDENCE, evidenceUsed, source: "template" };
  }

  const userPrompt = `Explain this TDS discrepancy using ONLY the evidence below. Follow the 5-point structure from your instructions. Keep it to a short paragraph plus a "Recommended action:" line.\n\nEvidence:\n${JSON.stringify(evidence, null, 2)}`;

  if (isLlmConfigured) {
    try {
      const explanation = await askLlm(SYSTEM_PROMPT, userPrompt);
      return { explanation, evidenceUsed, source: "llm" };
    } catch (err) {
      console.warn("LLM explainDiscrepancy failed, using template fallback:", err.message);
    }
  }

  return { explanation: templateExplainDiscrepancy(evidence), evidenceUsed, source: "template" };
}

function templateExplainDiscrepancy(evidence) {
  const direction = evidence.difference > 0 ? "under-deducted" : "over-deducted";
  const matchNote =
    evidence.matchingTransactions.length > 0
      ? `${evidence.matchingTransactions.length} similar transaction(s) for ${evidence.quantity} ${evidence.asset} were found elsewhere in the uploaded data, which was used to cross-check this figure.`
      : `No other transaction for ${evidence.quantity} ${evidence.asset} was found elsewhere in the uploaded data.`;

  return (
    `**Why is there a ${inr(Math.abs(evidence.difference))} discrepancy?**\n\n` +
    `Transaction ${evidence.transactionId} (${evidence.type} of ${evidence.quantity} ${evidence.asset} on ${evidence.sourceExchange}, ` +
    `${evidence.date}) has a TDS amount that appears ${direction}. Under ${evidence.ruleTriggered}, the expected TDS on ` +
    `${inr(evidence.amount)} is ${inr(evidence.expectedTds)}, but the data reports ${inr(evidence.reportedTds)} ` +
    `(source: ${evidence.reportedSource}) — a difference of ${inr(Math.abs(evidence.difference))}. ${matchNote}\n\n` +
    `**Recommended action:** ${
      evidence.riskTier === "high"
        ? "This is a high-risk gap — verify the exchange's TDS certificate for this transaction before finalizing the report."
        : "Verify the exchange's TDS certificate for this transaction to confirm the correct amount."
    }`
  );
}

// ---- 2. "Investigate with AI" (per transaction) ----------------------------
export async function investigateTransaction(evidence) {
  const evidenceUsed = [
    `Transaction ${evidence.transactionId}`,
    ...evidence.recordsUsedForReconciliation.filter((id) => id !== evidence.transactionId).map((id) => `Candidate record ${id}`),
    evidence.ruleTriggered,
  ].filter(Boolean);

  if (!hasSufficientEvidence(evidence)) {
    return { investigation: INSUFFICIENT_EVIDENCE, evidenceUsed, source: "template" };
  }

  const userPrompt =
    `Investigate this flagged transaction using ONLY the evidence below. Structure your answer as: ` +
    `1) What happened, 2) Why it was flagged, 3) Which records were used, 4) Evidence supporting the match/mismatch, ` +
    `5) Confidence level, 6) What the user should verify next.\n\nEvidence:\n${JSON.stringify(evidence, null, 2)}`;

  if (isLlmConfigured) {
    try {
      const investigation = await askLlm(SYSTEM_PROMPT, userPrompt);
      return { investigation, evidenceUsed, source: "llm" };
    } catch (err) {
      console.warn("LLM investigateTransaction failed, using template fallback:", err.message);
    }
  }

  return { investigation: templateInvestigate(evidence), evidenceUsed, source: "template" };
}

function templateInvestigate(evidence) {
  if (evidence.status === "TDS_GAP") {
    const tier = confidenceTier(evidence.matchingConfidence);
    return (
      `Transaction #${evidence.transactionId}\n\n` +
      `Status: ⚠ TDS Gap (transfer matched, TDS pending)\n\n` +
      `Reason:\n` +
      `This transfer of ${evidence.quantity} ${evidence.asset} from ${evidence.sourceExchange} to ${evidence.destinationExchange} ` +
      `WAS successfully matched — the discrepancy isn't about finding the transfer, it's that TDS status was still ` +
      `PENDING on the source exchange at the moment the asset left.\n\n` +
      `Evidence:\n` +
      `• Asset: ${evidence.asset}\n` +
      `• Quantity: ${evidence.quantity}\n` +
      `• Source: ${evidence.sourceExchange}\n` +
      `• Destination: ${evidence.destinationExchange}\n` +
      `• Transfer match confidence: ${evidence.matchingConfidence}%\n\n` +
      `AI recommendation:\n` +
      `Confirm with ${evidence.sourceExchange} whether TDS was eventually deducted on this transaction, since the ` +
      `snapshot in this data shows it as still pending at transfer time.` +
      (tier ? `\n\n${tier.emoji} ${tier.label}: ${evidence.matchingConfidence}%` : "")
    );
  }

  const tier = confidenceTier(evidence.matchingConfidence);
  const isWithdrawal = evidence.status === "ORPHANED_WITHDRAWAL";
  const direction = isWithdrawal ? "left" : "arrived on";
  const missingSide = isWithdrawal ? "destination" : "source";

  return (
    `Transaction #${evidence.transactionId}\n\n` +
    `Status: ⚠ Requires Review\n\n` +
    `Reason:\n` +
    `The system could not find a corresponding ${isWithdrawal ? "deposit" : "withdrawal"} for this ` +
    `${evidence.quantity} ${evidence.asset} transaction within the configured matching window.\n\n` +
    `Evidence:\n` +
    `• Asset: ${evidence.asset}\n` +
    `• Quantity: ${evidence.quantity}\n` +
    `• ${direction === "left" ? "Source" : "Destination"}: ${isWithdrawal ? evidence.sourceExchange : evidence.destinationExchange}\n` +
    `• ${missingSide === "destination" ? "Destination" : "Source"}: ${
      evidence.closestCandidate ? `${evidence.closestCandidate.exchange} (closest candidate, not confirmed)` : "Unknown"
    }\n` +
    `• Matching confidence: ${evidence.matchingConfidence}%\n\n` +
    `AI recommendation:\n` +
    `${
      evidence.closestCandidate
        ? `Verify whether ${evidence.closestCandidate.transactionId} on ${evidence.closestCandidate.exchange} is actually the ${
            isWithdrawal ? "destination" : "origin"
          } for this transfer before classifying it as ${isWithdrawal ? "a taxable disposal" : "having an unknown source"}.`
        : `Verify the ${missingSide} of this transaction manually — no candidate record was found in the uploaded data at all.`
    }` +
    (tier ? `\n\n${tier.emoji} ${tier.label}: ${evidence.matchingConfidence}%` : "")
  );
}

// ---- 3. "Ask ChainTDS about this report" -----------------------------------
export async function answerReportQuestion(question, reportContext) {
  const evidenceUsed = [
    `${reportContext.discrepancies.length} discrepancy record(s)`,
    `${reportContext.reconciliation.transferChecks.length} transfer match(es)`,
    `${reportContext.reconciliation.warnings.length + reportContext.reconciliation.unmatchedDeposits.length} flagged transaction(s)`,
  ];

  const userPrompt =
    `Answer the user's question using ONLY the structured report data below. If the data doesn't contain the answer, ` +
    `say so explicitly and recommend manual verification — do not guess.\n\n` +
    `Question: "${question}"\n\n` +
    `Report data:\n${JSON.stringify(
      {
        insights: reportContext.insights,
        discrepancies: reportContext.discrepancies,
        transferChecks: reportContext.reconciliation.transferChecks,
        warnings: reportContext.reconciliation.warnings,
        unmatchedDeposits: reportContext.reconciliation.unmatchedDeposits,
      },
      null,
      2
    )}`;

  if (isLlmConfigured) {
    try {
      const answer = await askLlm(SYSTEM_PROMPT, userPrompt);
      return { answer, evidenceUsed, source: "llm" };
    } catch (err) {
      console.warn("LLM answerReportQuestion failed, using template fallback:", err.message);
    }
  }

  return { answer: templateAnswer(question, reportContext), evidenceUsed, source: "template" };
}

// A small deterministic keyword router covering the exact example
// questions from the spec, so the chat box is genuinely useful even with
// no LLM configured at all — everything it says is read directly off
// reportContext, never invented.
function templateAnswer(question, reportContext) {
  const q = question.toLowerCase();
  const { insights, discrepancies, reconciliation } = reportContext;

  if (q.includes("largest discrepanc")) {
    if (discrepancies.length === 0) return "No TDS discrepancies were found in this report.";
    const top = [...discrepancies].sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)).slice(0, 3);
    return (
      "The largest discrepancies are:\n" +
      top.map((d) => `- ${d.transactionId} (${d.asset} on ${d.exchange}): ${inr(Math.abs(d.difference))} gap`).join("\n")
    );
  }

  if (q.includes("manual verification") || q.includes("verify") || q.includes("need") ) {
    const items = [
      ...reconciliation.warnings.map((w) => w.refId),
      ...reconciliation.unmatchedDeposits.map((d) => d.refId),
      ...discrepancies.filter((d) => d.riskTier !== "low").map((d) => d.transactionId),
    ];
    if (items.length === 0) return "Nothing in this report currently needs manual verification.";
    return `These transactions need manual verification before submitting: ${items.join(", ")}.`;
  }

  if (q.includes("missing")) {
    const missing = [...reconciliation.warnings, ...reconciliation.unmatchedDeposits];
    if (missing.length === 0) return "No missing records were detected — every transfer has a matching counterpart.";
    return `Missing/unmatched records:\n${missing.map((m) => `- ${m.message}`).join("\n")}`;
  }

  if (q.includes("tds") && (q.includes("different") || q.includes("why"))) {
    if (discrepancies.length === 0) return "No TDS discrepancies were found — reported TDS matches the expected 1% figure everywhere.";
    return `There ${discrepancies.length === 1 ? "is" : "are"} ${discrepancies.length} TDS discrepanc${
      discrepancies.length === 1 ? "y" : "ies"
    } totalling ${inr(discrepancies.reduce((s, d) => s + Math.abs(d.difference), 0))}. Ask "show me the largest discrepancies" for details on individual transactions.`;
  }

  if (q.includes("probable transfer")) {
    return `${insights.probableTransfers} transaction(s) were classified as probable transfers (matched but with medium confidence). These are worth a manual glance since the match wasn't a near-exact fit.`;
  }

  return (
    `I can answer questions about this report's discrepancies, unmatched transactions, and transfer confidence. ` +
    `This report has ${insights.totalTransactions} transactions, ${insights.tdsDiscrepancyCount} TDS discrepanc${
      insights.tdsDiscrepancyCount === 1 ? "y" : "ies"
    }, and ${insights.unmatchedTransactions} unmatched transaction(s). Try asking about the largest discrepancies or what needs manual verification.`
  );
}

export { confidenceTier };
