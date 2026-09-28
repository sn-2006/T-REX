import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { analyzeEthereumWallet } from "../services/walletTracing.js";

const router = Router();
router.post("/analyze", requireAuth, async (req, res) => {
  const address = typeof req.body?.address === "string" ? req.body.address : "";
  const includeNormalizedRows = req.body?.includeNormalizedRows === true;
  if (!address.trim()) return res.status(400).json({ error: "Wallet address is required." });
  try {
    let ownershipContext = {};
    try {
      const [userResult, caseResult] = await Promise.all([
        pool.query("SELECT id, kyc_status FROM users WHERE id = $1", [req.user.id]),
        pool.query("SELECT wallets FROM cases WHERE taxpayer_id = $1 AND is_demo = false", [req.user.id]),
      ]);
      const declaredWallets = caseResult.rows.flatMap((row) => Array.isArray(row.wallets) ? row.wallets : []);
      ownershipContext = {
        userId: userResult.rows[0]?.id || null,
        kycStatus: userResult.rows[0]?.kyc_status || null,
        caseWallets: declaredWallets,
        declaredWallets,
      };
    } catch (contextError) {
      console.warn("Could not load wallet ownership context:", contextError.message);
    }

    res.json(await analyzeEthereumWallet(address, { includeNormalizedRows, ownershipContext }));
  }
  catch (err) {
    console.error("Wallet analysis failed:", err);
    res.status(400).json({ error: err.message || "Wallet analysis failed." });
  }
});
export default router;
