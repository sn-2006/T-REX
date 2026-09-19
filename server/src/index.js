import "dotenv/config";

import express from "express";
import cors from "cors";

import binanceRoutes from "./routes/binance.js";
import walletRoutes from "./routes/wallet.js";
import authRoutes from "./routes/auth.js";
import caseRoutes from "./routes/cases.js";
import verifyRoutes from "./routes/verify.js";
import aiRoutes from "./routes/ai.js";
import verificationRoutes from "./routes/verification.js";
import complianceRoutes from "./routes/compliance.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error("CORS origin not allowed."));
    },
  })
);

app.use(express.json({ limit: "50mb" }));

const API_PREFIX = process.env.VERCEL ? "" : "/api";

app.get(`${API_PREFIX}/health`, (req, res) => {
  res.json({ ok: true });
});

app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/cases`, caseRoutes);
app.use(`${API_PREFIX}/verify`, verifyRoutes);
app.use(`${API_PREFIX}/ai`, aiRoutes);
app.use(`${API_PREFIX}/verification`, verificationRoutes);
app.use(`${API_PREFIX}/compliance`, complianceRoutes);
app.use(`${API_PREFIX}/binance`, binanceRoutes);
app.use(`${API_PREFIX}/wallet`, walletRoutes);

app.use((err, req, res, next) => {
  console.error("SERVER ERROR:", err);

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request payload is too large.",
    });
  }

  res.status(500).json({
    error: err.message || "Unexpected server error.",
  });
});

export default app;

// Local development only.
// Vercel imports the Express app as a serverless function
// and provides its own HTTP listener.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 4000;

  app.listen(port, () => {
    console.log(`T-REX API listening on http://localhost:${port}`);
  });
}