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

      const result = await pool.query(
        `INSERT INTO auditor_requests
           (taxpayer_id, auditor_id, reason)
         VALUES ($1, $2, $3)
         RETURNING id, taxpayer_id, auditor_id, reason, status, created_at`,
        [req.user.id, auditorId, reason.trim()]
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

// Taxpayer views only their own requests
router.get(
  "/my",
  requireAuth,
  requireRole("taxpayer"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT ar.id,
                ar.auditor_id,
                u.name AS auditor_name,
                ar.reason,
                ar.status,
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
      const result = await pool.query(
        `SELECT ar.id,
                ar.reason,
                ar.status,
                ar.created_at,
                u.id AS taxpayer_id,
                u.name AS taxpayer_name,
                c.id AS conversation_id
         FROM auditor_requests ar
         JOIN users u
           ON u.id = ar.taxpayer_id
         LEFT JOIN auditor_relationships rel
           ON rel.taxpayer_id = ar.taxpayer_id
          AND rel.auditor_id = ar.auditor_id
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