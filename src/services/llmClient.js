import { getToken } from "../api/client.js";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api";

export const isLlmConfigured = Boolean(API_BASE_URL);

export async function askLlm(systemPrompt, userPrompt) {
  if (!isLlmConfigured) {
    throw new Error("AI API is not configured.");
  }

  const token = getToken();

  const res = await fetch(`${API_BASE_URL}/ai/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      systemPrompt,
      userPrompt,
    }),
  });

  if (!res.ok) {
    let errorMessage = `AI API responded with ${res.status}`;

    try {
      const data = await res.json();
      if (data?.error) {
        errorMessage = data.error;
      }
    } catch {
      // Keep the default error message.
    }

    throw new Error(errorMessage);
  }

  const data = await res.json();

  if (!data?.reply) {
    throw new Error("AI API returned an empty response.");
  }

  return data.reply.trim();
}