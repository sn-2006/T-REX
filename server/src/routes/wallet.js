import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { analyzeEthereumWallet } from "../services/walletTracing.js";

const router = Router();
router.post("/analyze", requireAuth, async (req, res) => {
  const address = typeof req.body?.address === "string" ? req.body.address : "";
  const includeNormalizedRows = req.body?.includeNormalizedRows === true;
  if (!address.trim()) return res.status(400).json({ error: "Wallet address is required." });
  try { res.json(await analyzeEthereumWallet(address, { includeNormalizedRows })); }
  catch (err) {
    console.error("Wallet analysis failed:", err);
    res.status(400).json({ error: err.message || "Wallet analysis failed." });
  }
});
export default router;
