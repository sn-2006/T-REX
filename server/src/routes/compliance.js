import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { analyzeRows } from "../compliance/tds.js";
import { pool } from "../db.js";
import { SECTION_194S_RULES } from "../../../shared/taxRules.js";

const router = Router();

const ALLOWED_DEDUCTOR_CATEGORIES = new Set(
  Object.values(SECTION_194S_RULES.deductorCategories)
);
const UNKNOWN_CATEGORY = SECTION_194S_RULES.deductorCategories.UNKNOWN;

function normalizeDeductorCategory(value) {
  const category = String(value ?? "").trim().toLowerCase();
  return ALLOWED_DEDUCTOR_CATEGORIES.has(category) ? category : UNKNOWN_CATEGORY;
}

// Clients must not inject per-row category overrides — the authenticated
// taxpayer's stored users.deductor_category is the only source of truth.
function sanitizeAnalyzeRows(rows) {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || !("deductorCategory" in row)) {
      return row;
    }
    const { deductorCategory: _ignored, ...rest } = row;
    return rest;
  });
}

async function loadTaxpayerDeductorCategory(userId) {
  const result = await pool.query(
    `SELECT deductor_category
     FROM users
     WHERE id = $1 AND role = 'taxpayer'`,
    [userId]
  );
  return normalizeDeductorCategory(result.rows[0]?.deductor_category);
}

router.post("/analyze", requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: "rows must be an array." });
  if (rows.length > 50000) {
    return res.status(413).json({
      error: "Too many transaction rows. Maximum supported is 50,000.",
    });
  }

  try {
    const taxpayerId = req.user.role === "taxpayer" ? req.user.id : null;
    const deductorCategory = taxpayerId
      ? await loadTaxpayerDeductorCategory(taxpayerId)
      : UNKNOWN_CATEGORY;

    // Intentionally ignore any client-supplied deductorCategory / userId /
    // taxpayerId on the request body — category comes only from the DB row
    // for req.user.id.
    const result = analyzeRows(sanitizeAnalyzeRows(rows), {
      taxpayerId,
      deductorCategory,
    });
    res.json(result);
  } catch (err) {
    console.error("Compliance analysis failed:", err);
    res.status(400).json({ error: err.message || "Compliance analysis failed." });
  }
});

export default router;
