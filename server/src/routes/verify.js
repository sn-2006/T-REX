import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// Public, no auth — this is what makes a report's QR code / verify link
// checkable from any device, the same job the on-chain contract does once
// deployed. Deliberately returns only the anchor/verification fields, never
// the taxpayer's PAN, transactions, or reconciliation detail.
router.get("/:hash", async (req, res) => {
  const result = await pool.query(
    `SELECT report_hash, anchor_network, anchor_tx_hash, anchor_block_number,
            anchor_timestamp, verification_url, created_at
     FROM cases WHERE report_hash = $1`,
    [req.params.hash]
  );
  const row = result.rows[0];
  // 200 + { found: false } rather than a 404 — "not anchored" is a valid,
  // expected answer here, not an error, and the frontend's apiFetch()
  // treats non-2xx responses as failures it should throw on.
  if (!row) return res.json({ found: false });

  res.json({
    found: true,
    reportHash: row.report_hash,
    network: row.anchor_network,
    txHash: row.anchor_tx_hash,
    blockNumber: row.anchor_block_number,
    timestamp: row.anchor_timestamp || row.created_at,
  });
});

export default router;
