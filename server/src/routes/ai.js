import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/ask", requireAuth, async (req, res) => {
  const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
  const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || "";
  const { systemPrompt, userPrompt } = req.body;

  if (!systemPrompt || !userPrompt) {
    return res.status(400).json({
      error: "Missing systemPrompt or userPrompt.",
    });
  }

  try {
    const ollamaResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
        options: {
          temperature: 0.2,
        },
      }),
    });

    if (!ollamaResponse.ok) {
      throw new Error(`Ollama responded with ${ollamaResponse.status}`);
    }

    const data = await ollamaResponse.json();

    const reply = data?.message?.content?.trim();

    if (!reply) {
      throw new Error("Ollama returned an empty response.");
    }

    res.json({ reply });
  } catch (err) {
    console.error("Ollama request failed:", err.message);
    res.status(502).json({
      error: "AI service unavailable.",
    });
  }
});

export default router;