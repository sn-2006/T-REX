import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 AND role = $2 ORDER BY created_at DESC",
      [req.user.id, req.user.role]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't fetch notifications" });
  }
});

router.post("/read", requireAuth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE notifications SET read = true WHERE user_id = $1 AND role = $2",
      [req.user.id, req.user.role]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't mark notifications as read" });
  }
});

export default router;
