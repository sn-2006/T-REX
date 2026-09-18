import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function buildReportPdf({ tradeSummary, transferChecks, warnings, narrative, reportHash, anchor }) {
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(16);
  doc.text("ChainTDS Reconciliation Report", 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toISOString()}`, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text("Trade Summary", 14, y);
  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Exchange", "Asset", "Trades", "Total Amount", "Total INR", "TDS Deducted"]],
    body: tradeSummary.map((s) => [
      s.exchange,
      s.asset,
      s.tradeCount,
      s.totalTraded.toFixed(4),
      s.totalInr.toLocaleString("en-IN"),
      `${s.tdsDeductedCount}/${s.tradeCount}`,
    ]),
    styles: { fontSize: 9 },
  });
  y = doc.lastAutoTable.finalY + 10;

  doc.setFontSize(12);
  doc.text("Cross-Platform Transfer Check", 14, y);
  y += 4;
  autoTable(doc, {
    startY: y,
    head: [["Asset", "Amount", "From", "To", "Status"]],
    body: transferChecks.map((t) => [t.asset, t.amount, t.from, t.to, t.status]),
    styles: { fontSize: 9 },
  });
  y = doc.lastAutoTable.finalY + 10;

  if (y > 250) {
    doc.addPage();
    y = 18;
  }

  doc.setFontSize(12);
  doc.text("AI Summary", 14, y);
  y += 6;
  doc.setFontSize(9);
  const wrapped = doc.splitTextToSize(narrative, 180);
  doc.text(wrapped, 14, y);
  y += wrapped.length * 4 + 8;

  if (y > 260) {
    doc.addPage();
    y = 18;
  }

  doc.setFontSize(12);
  doc.text("Integrity", 14, y);
  y += 6;
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
