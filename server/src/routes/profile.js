import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { SECTION_194S_RULES } from "../../../shared/taxRules.js";

const router = Router();

const ALLOWED_DEDUCTOR_CATEGORIES = new Set(
  Object.values(SECTION_194S_RULES.deductorCategories)
);

function toProfile(row) {
  return {
    role: row.role,
    externalId: row.external_id,
    name: row.name,
    email: row.email,
    deductorCategory: row.deductor_category,
  };
}

// GET /api/profile — authenticated taxpayer's own profile fields needed by
// Account Settings. Ownership is always req.user.id from the JWT; any
// client-supplied userId/taxpayerId is ignored.
router.get("/", requireAuth, requireRole("taxpayer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT role, external_id, name, email, deductor_category
       FROM users
       WHERE id = $1 AND role = 'taxpayer'`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: "Taxpayer profile not found." });
    }
    res.json(toProfile(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't load your profile." });
  }
});

// PATCH /api/profile — update only the authenticated taxpayer's Section 194S
// deductor category. Never use a body userId/taxpayerId to choose the row.
router.patch("/", requireAuth, requireRole("taxpayer"), async (req, res) => {
  const raw = req.body?.deductorCategory;
  const deductorCategory =
    typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!deductorCategory) {
    return res.status(400).json({
      error: "Select a Section 194S deductor category.",
    });
  }
  if (!ALLOWED_DEDUCTOR_CATEGORIES.has(deductorCategory)) {
    return res.status(400).json({
      error:
        "Invalid deductor category. Use specified_person, other_person, or unknown.",
    });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET deductor_category = $1
       WHERE id = $2 AND role = 'taxpayer'
       RETURNING role, external_id, name, email, deductor_category`,
      [deductorCategory, req.user.id]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: "Taxpayer profile not found." });
    }
    res.json(toProfile(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't update your profile." });
  }
});

export default router;
