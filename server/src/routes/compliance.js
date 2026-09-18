import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { analyzeRows } from "../compliance/tds.js";

const router = Router();

router.post("/analyze", requireAuth, (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: "rows must be an array." });
  if (rows.length > 50000) {
  return res.status(413).json({
    error: "Too many transaction rows. Maximum supported is 50,000.",
  });
}

  try {
    const result = analyzeRows(rows);
    res.json(result);
  } catch (err) {
    console.error("Compliance analysis failed:", err);
    res.status(400).json({ error: err.message || "Compliance analysis failed." });
  }
});

export default router;
