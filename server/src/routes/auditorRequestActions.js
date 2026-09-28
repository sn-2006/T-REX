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
         RETURNING id`,
        [request.taxpayer_id, request.auditor_id, request.id]
      );

      const relationshipId = relationshipResult.rows[0].id;

      const conversationResult = await client.query(
        `INSERT INTO conversations (relationship_id)
         VALUES ($1)
         RETURNING id`,
        [relationshipId]
      );

      const conversationId = conversationResult.rows[0].id;

      await client.query(
        `INSERT INTO notifications (user_id, role, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
        [request.taxpayer_id, 'taxpayer', 'Request Accepted', 'Your auditor request has been accepted. You can now start chatting.', '#/taxpayer/conversations']
      );

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
         RETURNING id, status, taxpayer_id`,
        [req.params.id, req.user.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Pending request not found.",
        });
      }
      
      const reqRow = result.rows[0];
      await pool.query(
        `INSERT INTO notifications (user_id, role, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
        [reqRow.taxpayer_id, 'taxpayer', 'Request Rejected', 'Your auditor request was rejected.', '#/taxpayer/previous-ca-records']
      );

      return res.json(reqRow);
    } catch (err) {
      console.error("Reject auditor request error:", err);

      return res.status(500).json({
        error: "Couldn't reject auditor request.",
      });
    }
  }
);

// Request close
router.patch(
  "/:id/request-close",
  requireAuth,
  async (req, res) => {
    try {
      // Find the request and ensure user is part of it
      const reqResult = await pool.query(
        `SELECT id, taxpayer_id, auditor_id, status FROM auditor_requests WHERE id = $1 AND (taxpayer_id = $2 OR auditor_id = $2)`,
        [req.params.id, req.user.id]
      );
      if (!reqResult.rowCount) return res.status(404).json({ error: "Active request not found." });
      
      const reqRow = reqResult.rows[0];
      if (reqRow.status !== 'Accepted') return res.status(400).json({ error: "Cannot request close on non-active request." });

      const result = await pool.query(
        `UPDATE auditor_requests
         SET pending_close = true, close_scheduled_at = NOW() + interval '6 hours', updated_at = NOW()
         WHERE id = $1
         RETURNING id`,
        [req.params.id]
      );

      const otherPartyId = req.user.id === reqRow.taxpayer_id ? reqRow.auditor_id : reqRow.taxpayer_id;
      const otherPartyRole = req.user.id === reqRow.taxpayer_id ? 'auditor' : 'taxpayer';
      
      await pool.query(
        `INSERT INTO notifications (user_id, role, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
        [otherPartyId, otherPartyRole, 'Closure Scheduled', 'The other party requested to close the engagement. It will close in 6 hours unless disputed.', '']
      );

      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Couldn't request close." });
    }
  }
);

// Dispute
router.patch(
  "/:id/dispute",
  requireAuth,
  async (req, res) => {
    try {
      const reqResult = await pool.query(
        `SELECT id, taxpayer_id, auditor_id, status, pending_close FROM auditor_requests WHERE id = $1 AND (taxpayer_id = $2 OR auditor_id = $2)`,
        [req.params.id, req.user.id]
      );
      if (!reqResult.rowCount) return res.status(404).json({ error: "Request not found." });
      
      const reqRow = reqResult.rows[0];
      if (reqRow.status !== 'Accepted' || !reqRow.pending_close) return res.status(400).json({ error: "Cannot dispute." });

      await pool.query(
        `UPDATE auditor_requests
         SET status = 'Disputed', pending_close = false, close_scheduled_at = NULL, updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      );

      const otherPartyId = req.user.id === reqRow.taxpayer_id ? reqRow.auditor_id : reqRow.taxpayer_id;
      const otherPartyRole = req.user.id === reqRow.taxpayer_id ? 'auditor' : 'taxpayer';
      
      await pool.query(
        `INSERT INTO notifications (user_id, role, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
        [otherPartyId, otherPartyRole, 'Dispute Raised', 'The closure was disputed. The engagement remains open.', '']
      );

      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Couldn't dispute." });
    }
  }
);

export default router;