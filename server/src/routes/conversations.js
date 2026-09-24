import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/conversations/:id/messages
// Only participants in the conversation can view messages.
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
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, sender_id, message)
       SELECT c.id, $2, $3
       FROM conversations c
       JOIN auditor_relationships ar ON ar.id = c.relationship_id
       WHERE c.id = $1
         AND (ar.taxpayer_id = $2 OR ar.auditor_id = $2)
       RETURNING id, conversation_id, sender_id, message, created_at`,
      [req.params.id, req.user.id, message]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Conversation not found.",
      });
    }

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Send message error:", err);
    return res.status(500).json({
      error: "Couldn't send message.",
    });
  }
});

export default router;