import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function buildReportPdf({
  tradeSummary,
  transferChecks,
  warnings,
  narrative,
  reportHash,
  anchor,
}) {
  const doc = new jsPDF();
  let y = 18;

  function ensureSpace(required = 15) {
    if (y + required > 275) {
      doc.addPage();
      y = 18;
    }
  }

  function addHeading(text) {
    ensureSpace(12);
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.text(text, 14, y);
    doc.setFont(undefined, "normal");
    y += 7;
  }

  function addParagraph(text, fontSize = 9) {
    doc.setFontSize(fontSize);

    const wrapped = doc.splitTextToSize(text, 180);
    const lineHeight = 4.5;

    for (const line of wrapped) {
      ensureSpace(lineHeight + 2);
      doc.text(line, 14, y);
      y += lineHeight;
    }

    y += 2;
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text("ChainTDS Reconciliation Report", 14, y);

  doc.setFont(undefined, "normal");
  y += 8;

  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toISOString()}`, 14, y);
  y += 10;

  // -------------------------------------------------------------------------
  // Trade Summary
  // -------------------------------------------------------------------------

  addHeading("Trade Summary");

  autoTable(doc, {
    startY: y,
    head: [[
      "Exchange",
      "Asset",
      "Trades",
      "Total Amount",
      "Total INR",
      "TDS Deducted",
    ]],
    body: tradeSummary.map((s) => [
      s.exchange,
      s.asset,
      s.tradeCount,
      s.totalTraded.toFixed(4),
      s.totalInr.toLocaleString("en-IN"),
      `${s.tdsDeductedCount}/${s.tradeCount}`,
    ]),
    styles: {
      fontSize: 9,
    },
    margin: {
      left: 14,
      right: 14,
    },
  });

  y = doc.lastAutoTable.finalY + 10;

  // -------------------------------------------------------------------------
  // Transfer Check
  // -------------------------------------------------------------------------

  addHeading("Cross-Platform Transfer Check");

  autoTable(doc, {
    startY: y,
    head: [[
      "Asset",
      "Amount",
      "From",
      "To",
      "Status",
      "Confidence",
    ]],
    body: transferChecks.map((t) => [
      t.asset,
      t.amount,
      t.from,
      t.to,
      t.status === "TDS_GAP" ? "TDS Gap" : "OK",
      `${t.confidence}%`,
    ]),
    styles: {
      fontSize: 9,
    },
    margin: {
      left: 14,
      right: 14,
    },
  });

  y = doc.lastAutoTable.finalY + 10;

  // -------------------------------------------------------------------------
  // AI / Compliance Summary
  // -------------------------------------------------------------------------

  addHeading("AI Compliance Summary");

  const summaryLines = narrative.split("\n");

  for (const line of summaryLines) {
    const trimmed = line.trim();

    if (!trimmed) {
      y += 3;
      continue;
    }

    const isSectionHeading =
      trimmed === "OVERALL ASSESSMENT" ||
      trimmed === "TRADE SUMMARY" ||
      trimmed === "TRANSFER ANALYSIS" ||
      trimmed === "UNMATCHED TRANSACTIONS" ||
      trimmed === "RECOMMENDED ACTIONS";

    if (isSectionHeading) {
      ensureSpace(12);

      y += 2;
      doc.setFontSize(10);
      doc.setFont(undefined, "bold");
      doc.text(trimmed, 14, y);
      doc.setFont(undefined, "normal");

      y += 6;
      continue;
    }

    const isBullet = trimmed.startsWith("- ");
    const text = isBullet ? trimmed.substring(2) : trimmed;

    doc.setFontSize(9);

    const wrapped = doc.splitTextToSize(text, isBullet ? 170 : 180);

    for (let i = 0; i < wrapped.length; i++) {
      ensureSpace(5);

      if (isBullet && i === 0) {
        doc.text("-", 14, y);
        doc.text(wrapped[i], 20, y);
      } else {
        doc.text(wrapped[i], isBullet ? 20 : 14, y);
      }

      y += 4.5;
    }

    y += 1;
  }

  // -------------------------------------------------------------------------
  // Integrity
  // -------------------------------------------------------------------------

  ensureSpace(25);

  addHeading("Integrity");

  doc.setFontSize(9);
  doc.text(`SHA-256: ${reportHash}`, 14, y);
  y += 5;

  if (anchor) {
    doc.text(`On-chain tx: ${anchor.txHash}`, 14, y);
    y += 5;

    doc.text(`Network: ${anchor.network}`, 14, y);
  }

  return doc;
}