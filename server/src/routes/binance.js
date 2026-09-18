import express from "express";
import { fetchBinanceTrades } from "../../binance.js";

const router = express.Router();

router.post("/trades", async (req, res) => {
  try {
    const {
      apiKey,
      apiSecret,
      from,
      to,
    } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        error: "Binance API key and API secret are required.",
      });
    }

    if (!from || !to) {
      return res.status(400).json({
        error: "From date and To date are required.",
      });
    }

    const trades = await fetchBinanceTrades({
      apiKey,
      apiSecret,
      from: new Date(from).getTime(),
      to: new Date(to).getTime() + 86_399_999,
    });

    return res.json({
      success: true,
      exchange: "binance",
      count: trades.length,
      transactions: trades,
    });
  } catch (error) {
    console.error(
      "Binance API error:",
      error.binanceResponse || error.message
    );

    return res.status(error.status || 400).json({
      success: false,
      error:
        error.binanceResponse?.msg ||
        error.message ||
        "Failed to fetch Binance transactions.",
    });
  }
});

export default router;