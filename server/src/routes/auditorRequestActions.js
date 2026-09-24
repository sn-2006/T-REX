import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// Accept a request and create its relationship + conversation
router.patch(
  "/:id/accept",
  requireAuth,
  requireRole("auditor"),
  async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Lock the request and verify it belongs to this auditor
      const requestResult = await client.query(
        `SELECT id, taxpayer_id, auditor_id, status
         FROM auditor_requests
         WHERE id = $1 AND auditor_id = $2
         FOR UPDATE`,
        [id, req.user.id]
      );

      if (!requestResult.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Request not found." });
      }

      const request = requestResult.rows[0];

      if (request.status !== "Pending") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `Request is already ${request.status}.`,
        });
      }

      await client.query(
        `UPDATE auditor_requests
         SET status = 'Accepted', updated_at = NOW()
         WHERE id = $1`,
        [id]
      );

      const relationshipResult = await client.query(
        `INSERT INTO auditor_relationships
           (taxpayer_id, auditor_id, request_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (taxpayer_id, auditor_id)
         DO UPDATE SET taxpayer_id = EXCLUDED.taxpayer_id
         RETURNING id`,
        [request.taxpayer_id, request.auditor_id, request.id]
      );

      const relationshipId = relationshipResult.rows[0].id;

      // Reuse an existing conversation if one already exists
      const conversationResult = await client.query(
        `INSERT INTO conversations (relationship_id)
         VALUES ($1)
         ON CONFLICT (relationship_id)
         DO UPDATE SET relationship_id = EXCLUDED.relationship_id
         RETURNING id`,
        [relationshipId]
      );

      const conversationId = conversationResult.rows[0].id;

      await client.query("COMMIT");

      return res.json({
        status: "Accepted",
        relationshipId,
        conversationId,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Accept auditor request error:", err);

      return res.status(500).json({
        error: "Couldn't accept auditor request.",
      });
    } finally {
      client.release();
    }
  }
);

// Reject a request assigned to the logged-in auditor
router.patch(
  "/:id/reject",
  requireAuth,
  requireRole("auditor"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `UPDATE auditor_requests
         SET status = 'Rejected', updated_at = NOW()
         WHERE id = $1
           AND auditor_id = $2
           AND status = 'Pending'
         RETURNING id, status`,
        [req.params.id, req.user.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Pending request not found.",
        });
      }

      return res.json(result.rows[0]);
    } catch (err) {
      console.error("Reject auditor request error:", err);

      return res.status(500).json({
        error: "Couldn't reject auditor request.",
      });
    }
  }
);

export default router;