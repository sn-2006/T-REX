// ---------------------------------------------------------------------------
// Minimal LLM client. aiReport.js already documented the intended backend
// as Ollama (a local Llama model) — this implements that call, plus an
// OpenAI-compatible mode so the same code also works against a hosted
// Llama endpoint (Groq, Together, OpenRouter, etc.) if that's preferred.
//
// Configure via .env (see .env.example):
//   VITE_LLM_BASE_URL   default "http://localhost:11434" (Ollama's default)
//   VITE_LLM_MODEL       default "llama3.1"
//   VITE_LLM_API_MODE    "ollama" (default) or "openai"
//   VITE_LLM_API_KEY     only needed for openai-mode hosted providers
//
// Nothing in this file decides anything about tax/TDS compliance — it's a
// dumb transport. All compliance logic and prompt construction live in
// services/complianceAssistant.js.
// ---------------------------------------------------------------------------

const ENV = import.meta.env ?? {};
const BASE_URL = ENV.VITE_LLM_BASE_URL || "http://localhost:11434";
const MODEL = ENV.VITE_LLM_MODEL || "llama3.1";
const API_MODE = ENV.VITE_LLM_API_MODE || "ollama";
const API_KEY = ENV.VITE_LLM_API_KEY || "";

// This is intentionally optimistic — the only reliable way to know if an
// LLM is actually reachable is to try a call and see if it fails, which is
// exactly what askLlm's callers do (they catch failures and fall back to
// the deterministic template explainer). This flag just controls whether
// it's worth attempting the call at all.
export const isLlmConfigured = Boolean(BASE_URL);

async function callOllama(systemPrompt, userPrompt) {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama responded with ${res.status}`);
  const data = await res.json();
  return data?.message?.content?.trim();
}

async function callOpenAiCompatible(systemPrompt, userPrompt) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM API responded with ${res.status}`);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim();
}

// Throws on any failure (model not running, network error, bad response) —
// callers are expected to catch this and fall back to a deterministic
// template explanation so the UI never shows a dead end.
export async function askLlm(systemPrompt, userPrompt) {
  if (!isLlmConfigured) throw new Error("No LLM base URL configured.");
  const reply = API_MODE === "openai" ? await callOpenAiCompatible(systemPrompt, userPrompt) : await callOllama(systemPrompt, userPrompt);
  if (!reply) throw new Error("LLM returned an empty response.");
  return reply;
}
