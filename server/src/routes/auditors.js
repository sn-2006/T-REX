import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

// GET /api/auditors
// Return registered auditors only; never expose credentials.
router.get("/", requireAuth, requireRole("taxpayer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, external_id, name, created_at
       FROM users
       WHERE role = 'auditor'
       ORDER BY name ASC`
    );

    res.json(
      result.rows.map((auditor) => ({
        id: auditor.id,
        auditorId: auditor.external_id,
        name: auditor.name,
        expertise: null,
        experienceYears: null,
        availability: "Available",
      }))
    );
  } catch (err) {
    console.error("Auditor directory error:", err);
    res.status(500).json({ error: "Couldn't load auditors." });
  }
});

export default router;