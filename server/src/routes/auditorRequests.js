import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Taxpayer submits a request to an auditor
router.post(
  "/",
  requireAuth,
  requireRole("taxpayer"),
  async (req, res) => {
    const { auditorId, reason } = req.body;

    if (!auditorId || !reason?.trim()) {
      return res.status(400).json({
        error: "auditorId and reason are required.",
      });
    }

    try {
      const auditor = await pool.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND role = 'auditor'`,
        [auditorId]
      );

      if (!auditor.rowCount) {
        return res.status(404).json({
          error: "Auditor not found.",
        });
      }

      const activeRequest = await pool.query(
        `SELECT id FROM auditor_requests WHERE taxpayer_id = $1 AND auditor_id = $2 AND status IN ('Pending', 'Accepted')`,
        [req.user.id, auditorId]
      );

      if (activeRequest.rowCount > 0) {
        return res.status(409).json({
          error: "You already have an active or pending connection request to this CA.",
        });
      }

      const result = await pool.query(
        `INSERT INTO auditor_requests
           (taxpayer_id, auditor_id, reason)
         VALUES ($1, $2, $3)
         RETURNING id, taxpayer_id, auditor_id, reason, status, created_at`,
        [req.user.id, auditorId, reason.trim()]
      );

      await pool.query(
        `INSERT INTO notifications (user_id, role, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
        [auditorId, 'auditor', 'New Request', 'A taxpayer has requested your assistance.', '#/auditor/incoming-requests']
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("Create auditor request error:", err);

      return res.status(500).json({
        error: "Couldn't create auditor request.",
      });
    }
  }
);

async function autoCloseExpired() {
  const expired = await pool.query(
    `UPDATE auditor_requests
     SET status = 'Closed', pending_close = false, close_scheduled_at = NULL, updated_at = NOW()
     WHERE pending_close = true AND close_scheduled_at <= NOW()
     RETURNING id, taxpayer_id, auditor_id`
  );
  for (const row of expired.rows) {
    await pool.query(
      `INSERT INTO notifications (user_id, role, title, message, link) VALUES 
      ($1, 'taxpayer', 'Engagement Closed', 'The engagement was automatically closed after 6 hours.', '#/taxpayer/previous-ca-records'),
      ($2, 'auditor', 'Engagement Closed', 'The engagement was automatically closed after 6 hours.', '#/auditor/closed-requests')`,
      [row.taxpayer_id, row.auditor_id]
    );
  }
}

// Taxpayer views only their own requests
router.get(
  "/my",
  requireAuth,
  requireRole("taxpayer"),
  async (req, res) => {
    try {
      await autoCloseExpired();
      const result = await pool.query(
        `SELECT ar.id,
                ar.auditor_id,
                u.name AS auditor_name,
                ar.reason,
                ar.status,
                ar.pending_close,
                ar.close_scheduled_at,
                ar.created_at
         FROM auditor_requests ar
         JOIN users u
           ON u.id = ar.auditor_id
         WHERE ar.taxpayer_id = $1
         ORDER BY ar.created_at DESC`,
        [req.user.id]
      );

      return res.json(result.rows);
    } catch (err) {
      console.error("Fetch taxpayer requests error:", err);

      return res.status(500).json({
        error: "Couldn't load your auditor requests.",
      });
    }
  }
);

// Auditor views only requests assigned to them
router.get(
  "/incoming",
  requireAuth,
  requireRole("auditor"),
  async (req, res) => {
    try {
      await autoCloseExpired();
      const result = await pool.query(
        `SELECT ar.id,
                ar.reason,
                ar.status,
                ar.pending_close,
                ar.close_scheduled_at,
                ar.created_at,
                u.id AS taxpayer_id,
                u.name AS taxpayer_name,
                c.id AS conversation_id
         FROM auditor_requests ar
         JOIN users u
           ON u.id = ar.taxpayer_id
         LEFT JOIN auditor_relationships rel
           ON rel.request_id = ar.id
         LEFT JOIN conversations c
           ON c.relationship_id = rel.id
         WHERE ar.auditor_id = $1
         ORDER BY ar.created_at DESC`,
        [req.user.id]
      );

      return res.json(result.rows);
    } catch (err) {
      console.error("Fetch incoming requests error:", err);

      return res.status(500).json({
        error: "Couldn't load incoming requests.",
      });
    }
  }
);

export default router;