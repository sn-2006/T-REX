function canonicalize(value) {
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }

  return value;
}

// Produces a SHA-256 hex digest of a canonical representation so equivalent
// report data has the same digest regardless of property or array ordering.
export async function sha256Hex(obj) {
  const text = typeof obj === "string" ? obj : JSON.stringify(canonicalize(obj));
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Prototype-only stand-in for the real Polygon Amoy anchoring transaction.
// Wiring this to an actual deployed Solidity contract via ethers.js is the
// next step once the reconciliation + report pipeline above is solid.
export function mockAnchorOnChain(hash) {
  const fakeTxHash =
    "0x" +
    Array.from({ length: 64 }, () =>
      "0123456789abcdef"[Math.floor(Math.random() * 16)]
    ).join("");
  return {
    network: "Polygon Amoy (simulated)",
    txHash: fakeTxHash,
    blockNumber: 12_400_000 + Math.floor(Math.random() * 5000),
    timestamp: new Date().toISOString(),
    reportHash: hash,
    verificationUrl: `https://chaintds-verify.example/report/${hash.slice(0, 16)}`,
  };
}
