import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Every field the frontend's caseStore.js/mockCases.js currently reads —
// keep this in sync with the `SELECT` list below.
function rowToCase(row, transactions) {
  return {
    id: row.id,
    taxpayerId: row.taxpayer_external_id,
    taxpayerName: row.taxpayer_name,
    taxpayerRegion: row.taxpayer_region,
    panMasked: row.taxpayer_external_id,
    auditorId: row.auditor_external_id,
    exchanges: row.exchanges,
    wallets: row.wallets,
    allRows: transactions.map((t) => ({
      exchange: t.exchange,
      date: t.tx_date instanceof Date ? t.tx_date.toISOString().slice(0, 10) : String(t.tx_date).slice(0, 10),
      type: t.type,
      asset: t.asset,
      amount: Number(t.amount),
      inrValue: Number(t.inr_value),
      tdsStatus: t.tds_status,
      tdsAmount: t.tds_amount === null ? null : Number(t.tds_amount),
      refId: t.ref_id,
    })),
    reconciliation: row.reconciliation,
    discrepancies: row.discrepancies,
    insights: row.insights,
    narrative: row.narrative,
    reportHash: row.report_hash,
    anchor: row.anchor_tx_hash
      ? {
          network: row.anchor_network,
          txHash: row.anchor_tx_hash,
          blockNumber: row.anchor_block_number,
          timestamp: row.anchor_timestamp,
          reportHash: row.report_hash,
          verificationUrl: row.verification_url,
        }
      : null,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    demo: row.is_demo,
  };
}

const CASE_SELECT = `
  SELECT c.*, tp.external_id AS taxpayer_external_id, tp.name AS taxpayer_name,
         tp.region AS taxpayer_region, au.external_id AS auditor_external_id
  FROM cases c
  JOIN users tp ON tp.id = c.taxpayer_id
  LEFT JOIN users au ON au.id = c.auditor_id
`;

async function loadCaseWithTransactions(client, caseId) {
  const caseResult = await client.query(`${CASE_SELECT} WHERE c.id = $1`, [caseId]);
  if (caseResult.rows.length === 0) return null;
  const txResult = await client.query(
    "SELECT * FROM transactions WHERE case_id = $1 ORDER BY tx_date, id",
    [caseId]
  );
  return rowToCase(caseResult.rows[0], txResult.rows);
}

// ---------------------------------------------------------------------------
// POST /api/cases — create (or replace) a finalized report. Taxpayer-only;
// req.user.id is trusted as the owning taxpayer, never taken from the body.
//
// Cases are created UNASSIGNED (auditor_id NULL). Rather than silently
// round-robining an auditor onto every new case, the case sits in the
// shared "client requests" pool (GET /unassigned) until some auditor
// actively accepts it (POST /:id/accept) — see that route below.
// ---------------------------------------------------------------------------
router.post("/", requireAuth, requireRole("taxpayer"), async (req, res) => {
  // Verification gate: a report can't be submitted until the taxpayer has
  // confirmed their email and passed KYC. Checked fresh against the
  // database rather than trusting the JWT, since the token was issued at
  // login — possibly before either step was completed in this same
  // session — and never automatically refreshes.
  const verifyResult = await pool.query(
    "SELECT email_verified, kyc_status FROM users WHERE id = $1",
    [req.user.id]
  );
  const { email_verified, kyc_status } = verifyResult.rows[0];
  if (!email_verified || kyc_status !== "verified") {
    return res.status(403).json({
      error: "Verify your email and complete KYC before generating a report.",
      emailVerified: email_verified,
      kycStatus: kyc_status,
    });
  }

  const {
    id, // report hash, used as the case id
    exchanges = [],
    wallets = [],
    allRows = [],
    reconciliation,
    discrepancies,
    insights,
    narrative,
    reportHash,
    anchor,
    status,
  } = req.body;

  if (!id || !reportHash || !reconciliation || !discrepancies || !insights) {
    return res.status(400).json({ error: "Missing required report fields." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const auditorId = null; // unassigned until an auditor accepts it

    await client.query(
      `INSERT INTO cases (
         id, taxpayer_id, auditor_id, exchanges, wallets,
         reconciliation, discrepancies, insights, narrative, report_hash,
         anchor_network, anchor_tx_hash, anchor_block_number, anchor_timestamp, verification_url,
         status, review_note, is_demo
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15,
         $16, '', false
       )
       ON CONFLICT (id) DO UPDATE SET
         reconciliation = EXCLUDED.reconciliation,
         discrepancies = EXCLUDED.discrepancies,
         insights = EXCLUDED.insights,
         narrative = EXCLUDED.narrative,
         anchor_network = EXCLUDED.anchor_network,
         anchor_tx_hash = EXCLUDED.anchor_tx_hash,
         anchor_block_number = EXCLUDED.anchor_block_number,
         anchor_timestamp = EXCLUDED.anchor_timestamp,
         verification_url = EXCLUDED.verification_url,
         status = EXCLUDED.status`,
      [
        id,
        req.user.id,
        auditorId,
        exchanges,
        wallets,
        // node-postgres converts raw JS arrays to Postgres array-literal
        // syntax ("{}"), not JSON — which a jsonb column then happily
        // parses as an empty OBJECT, silently corrupting `discrepancies`
        // (a top-level array) into `{}`. Stringify every jsonb field
        // explicitly so it's unambiguous JSON on the wire.
        JSON.stringify(reconciliation),
        JSON.stringify(discrepancies),
        JSON.stringify(insights),
        narrative || null,
        reportHash,
        anchor?.network || null,
        anchor?.txHash || null,
        anchor?.blockNumber || null,
        anchor?.timestamp || null,
        anchor?.verificationUrl || null,
        status || "pending",
      ]
    );

    // Replace this case's transaction rows wholesale — simplest correct
    // behavior for the "regenerate a report" case, and cheap since a report
    // is at most a few hundred rows.
    await client.query("DELETE FROM transactions WHERE case_id = $1", [id]);
    for (const r of allRows) {
      await client.query(
        `INSERT INTO transactions (case_id, exchange, tx_date, type, asset, amount, inr_value, tds_status, tds_amount, ref_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (case_id, ref_id) DO NOTHING`,
        [id, r.exchange, r.date, r.type, r.asset, r.amount, r.inrValue, r.tdsStatus, r.tdsAmount ?? null, r.refId]
      );
    }

    await client.query("COMMIT");

    const created = await loadCaseWithTransactions(client, id);
    res.status(201).json(created);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't save the report." });
  } finally {
    client.release();
  }
});

// GET /api/cases/mine — taxpayer's own cases.
router.get("/mine", requireAuth, requireRole("taxpayer"), async (req, res) => {
  const result = await pool.query(
    `${CASE_SELECT} WHERE tp.role = 'taxpayer' AND tp.id = $1 ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json(await attachTransactions(result.rows));
});

// GET /api/cases/assigned — auditor's assigned cases.
router.get("/assigned", requireAuth, requireRole("auditor"), async (req, res) => {
  const result = await pool.query(`${CASE_SELECT} WHERE c.auditor_id = $1 ORDER BY c.created_at DESC`, [
    req.user.id,
  ]);
  res.json(await attachTransactions(result.rows));
});

// GET /api/cases/unassigned — taxpayer clients waiting for any auditor to
// pick them up. Any auditor can see this shared pool; accepting one (below)
// is what actually assigns it.
router.get("/unassigned", requireAuth, requireRole("auditor"), async (req, res) => {
  const result = await pool.query(
    `${CASE_SELECT} WHERE c.auditor_id IS NULL ORDER BY c.created_at ASC`
  );
  res.json(await attachTransactions(result.rows));
});

// POST /api/cases/:id/accept — an auditor accepts an unassigned client's
// case. The WHERE auditor_id IS NULL guard makes this atomic: if two
// auditors accept the same case at once, only the first UPDATE matches a
// row — the second gets 0 rows back and a 409, instead of silently
// stealing the case out from under the first auditor.
router.post("/:id/accept", requireAuth, requireRole("auditor"), async (req, res) => {
  const result = await pool.query(
    `UPDATE cases SET auditor_id = $1 WHERE id = $2 AND auditor_id IS NULL RETURNING id`,
    [req.user.id, req.params.id]
  );
  if (result.rows.length === 0) {
    return res
      .status(409)
      .json({ error: "This case was already accepted by another auditor." });
  }

  const client = await pool.connect();
  try {
    const updated = await loadCaseWithTransactions(client, req.params.id);
    res.json(updated);
  } finally {
    client.release();
  }
});

// GET /api/cases — all cases, read-only, regulator only.
router.get("/", requireAuth, requireRole("regulator"), async (req, res) => {
  const result = await pool.query(`${CASE_SELECT} ORDER BY c.created_at DESC`);
  res.json(await attachTransactions(result.rows));
});

// GET /api/cases/:id — any authenticated role that can see the case
// (taxpayer who owns it, its assigned auditor, or any regulator).
router.get("/:id", requireAuth, async (req, res) => {
  const result = await pool.query(`${CASE_SELECT} WHERE c.id = $1`, [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ error: "Case not found." });

  const owns =
    req.user.role === "regulator" ||
    (req.user.role === "taxpayer" && row.taxpayer_external_id === req.user.externalId) ||
    (req.user.role === "auditor" && row.auditor_external_id === req.user.externalId);
  if (!owns) return res.status(403).json({ error: "You don't have access to this case." });

  const [c] = await attachTransactions([row]);
  res.json(c);
});

// PATCH /api/cases/:id/status — auditor approve/flag action.
router.patch("/:id/status", requireAuth, requireRole("auditor"), async (req, res) => {
  const { status, reviewNote } = req.body;
  if (!["verified", "flagged", "pending", "high-risk"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  const result = await pool.query(
    `UPDATE cases SET status = $1, review_note = COALESCE($2, review_note), reviewed_at = now()
     WHERE id = $3 AND auditor_id = $4
     RETURNING id`,
    [status, reviewNote ?? null, req.params.id, req.user.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Case not found or not assigned to you." });
  }

  const client = await pool.connect();
  try {
    const updated = await loadCaseWithTransactions(client, req.params.id);
    res.json(updated);
  } finally {
    client.release();
  }
});

async function attachTransactions(rows) {
  const results = [];
  for (const row of rows) {
    const txResult = await pool.query(
      "SELECT * FROM transactions WHERE case_id = $1 ORDER BY tx_date, id",
      [row.id]
    );
    results.push(rowToCase(row, txResult.rows));
  }
  return results;
}

export default router;
