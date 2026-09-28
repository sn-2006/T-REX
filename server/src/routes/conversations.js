import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// GET /api/conversations/:id/messages
// Only participants in the conversation can view messages.

router.get(
  "/my",
  requireAuth,
  requireRole("taxpayer"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT c.id AS conversation_id,
                ar.id AS relationship_id,
                u.id AS auditor_id,
                u.name AS auditor_name
         FROM conversations c
         JOIN auditor_relationships ar
           ON ar.id = c.relationship_id
         JOIN auditor_requests req
           ON req.id = ar.request_id
         JOIN users u
           ON u.id = ar.auditor_id
         WHERE ar.taxpayer_id = $1 AND req.status = 'Accepted'
         ORDER BY c.created_at DESC`,
        [req.user.id]
      );

      return res.json(
        result.rows.map((row) => ({
          conversationId: row.conversation_id,
          relationshipId: row.relationship_id,
          auditorId: row.auditor_id,
          auditorName: row.auditor_name,
        }))
      );
    } catch (err) {
      console.error("Fetch taxpayer conversations error:", err);
      return res.status(500).json({
        error: "Couldn't load your conversations.",
      });
    }
  }
);
router.get("/:id/messages", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT m.id, m.conversation_id, m.sender_id,
              u.name AS sender_name, u.role AS sender_role,
              m.message, m.created_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       JOIN conversations c ON c.id = m.conversation_id
       JOIN auditor_relationships ar ON ar.id = c.relationship_id
       WHERE c.id = $1
         AND (ar.taxpayer_id = $2 OR ar.auditor_id = $2)
       ORDER BY m.created_at ASC`,
      [req.params.id, req.user.id]
    );

    // Empty results may mean no messages or no access.
    // Verify participation separately to distinguish them.
    if (!result.rowCount) {
      const access = await pool.query(
        `SELECT c.id
         FROM conversations c
         JOIN auditor_relationships ar ON ar.id = c.relationship_id
         WHERE c.id = $1
           AND (ar.taxpayer_id = $2 OR ar.auditor_id = $2)`,
        [req.params.id, req.user.id]
      );

      if (!access.rowCount) {
        return res.status(404).json({
          error: "Conversation not found.",
        });
      }
    }

    return res.json(result.rows);
  } catch (err) {
    console.error("Fetch messages error:", err);
    return res.status(500).json({
      error: "Couldn't load messages.",
    });
  }
});

// POST /api/conversations/:id/messages
// Only participants can send messages.
router.post("/:id/messages", requireAuth, async (req, res) => {
  const message =
    typeof req.body.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    return res.status(400).json({
      error: "Message cannot be empty.",
    });
  }

  if (message.length > 5000) {
    return res.status(400).json({
      error: "Message cannot exceed 5000 characters.",
    });
  }

  try {
    const rel = await pool.query(
      `SELECT ar.taxpayer_id, ar.auditor_id, req.status
       FROM conversations c
       JOIN auditor_relationships ar ON ar.id = c.relationship_id
       JOIN auditor_requests req ON req.id = ar.request_id
       WHERE c.id = $1 AND (ar.taxpayer_id = $2 OR ar.auditor_id = $2)`,
      [req.params.id, req.user.id]
    );

    if (!rel.rowCount) {
      return res.status(404).json({ error: "Conversation not found." });
    }
    if (rel.rows[0].status !== 'Accepted') {
      return res.status(403).json({ error: "Cannot send messages to an inactive conversation." });
    }
    const { taxpayer_id, auditor_id } = rel.rows[0];

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, message)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, sender_id, message, created_at`,
      [req.params.id, req.user.id, message]
    );

    const newMsg = result.rows[0];
    const receiverId = req.user.id === taxpayer_id ? auditor_id : taxpayer_id;
    const receiverRole = req.user.id === taxpayer_id ? 'auditor' : 'taxpayer';
    const link = req.user.id === taxpayer_id ? `#/auditor/conversations/${newMsg.conversation_id}` : `#/taxpayer/conversations`;

    await pool.query(
      `INSERT INTO notifications (user_id, role, title, message, link) VALUES ($1, $2, $3, $4, $5)`,
      [receiverId, receiverRole, 'New Message', 'You have received a new message.', link]
    );

    return res.status(201).json(newMsg);
  } catch (err) {
    console.error("Send message error:", err);
    return res.status(500).json({
      error: "Couldn't send message.",
    });
  }
});

export default router;