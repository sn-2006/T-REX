import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end Phase 5 coverage for the taxpayer Category → Profile → Analyze
// path. Confirms a live DB update is picked up by compliance without JWT refresh.

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../server/.env") });

const { pool } = await import("../server/src/db.js");
const profileRoutes = (await import("../server/src/routes/profile.js")).default;
const complianceRoutes = (await import("../server/src/routes/compliance.js")).default;

const JWT_SECRET = process.env.JWT_SECRET;
assert.ok(JWT_SECRET, "JWT_SECRET must be set in server/.env for E2E category tests");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/profile", profileRoutes);
app.use("/api/compliance", complianceRoutes);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const root = `http://127.0.0.1:${port}/api`;

const stamp = Date.now().toString(36).toUpperCase();
const passwordHash = await bcrypt.hash("test-pass", 4);

const inserted = await pool.query(
  `INSERT INTO users (role, external_id, name, password_hash, region, email, deductor_category)
   VALUES
     ('taxpayer', $1, 'E2E Category Owner', $3, 'South', $4, 'unknown'),
     ('taxpayer', $2, 'E2E Category Other', $3, 'North', $5, 'other_person')
   RETURNING id, external_id, deductor_category::text AS deductor_category`,
  [
    `E2EA${stamp}`.slice(0, 10),
    `E2EB${stamp}`.slice(0, 10),
    passwordHash,
    `e2ea_${stamp}@example.com`,
    `e2eb_${stamp}@example.com`,
  ]
);

const [owner, other] = inserted.rows;
assert.equal(owner.deductor_category, "unknown");

// Issue once and reuse — live category updates must not require re-login.
const ownerToken = jwt.sign(
  {
    id: owner.id,
    role: "taxpayer",
    externalId: owner.external_id,
    name: "E2E Category Owner",
    deductorCategory: "unknown",
  },
  JWT_SECRET,
  { expiresIn: "15m" }
);
const otherToken = jwt.sign(
  {
    id: other.id,
    role: "taxpayer",
    externalId: other.external_id,
    name: "E2E Category Other",
  },
  JWT_SECRET,
  { expiresIn: "15m" }
);

async function api(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${root}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function sell(refId, amount, overrides = {}) {
  return {
    refId,
    date: "2025-05-10T10:00:00+05:30",
    exchange: "CEX",
    type: "SELL",
    asset: "ETH",
    assetType: "VDA",
    amount: 1,
    price: amount,
    quoteCurrency: "INR",
    tdsStatus: "UNKNOWN",
    counterparty: "buyer-1",
    ...overrides,
  };
}

function categoryOf(result, refId) {
  return result.data.rows.find((row) => row.refId === refId)?.financialYearAggregation
    ?.deductorCategory;
}

function thresholdOf(result, refId) {
  return result.data.rows.find((row) => row.refId === refId);
}

try {
  // 1. Existing user starts unknown; Account Settings load reflects DB.
  const loaded = await api("GET", "/profile", { token: ownerToken });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.data.deductorCategory, "unknown");

  const unknownAnalyze = await api("POST", "/compliance/analyze", {
    token: ownerToken,
    body: { rows: [sell("start-unknown", 20000)] },
  });
  assert.equal(unknownAnalyze.status, 200);
  assert.equal(categoryOf(unknownAnalyze, "start-unknown"), "unknown");
  assert.equal(thresholdOf(unknownAnalyze, "start-unknown").threshold_status, "REVIEW_REQUIRED");
  assert.equal(unknownAnalyze.data.tdsRows[0].expectedTds, null);

  // 2. Save specified_person via profile API; DB must update.
  const savedSpecified = await api("PATCH", "/profile", {
    token: ownerToken,
    body: { deductorCategory: "specified_person" },
  });
  assert.equal(savedSpecified.status, 200);
  assert.equal(savedSpecified.data.deductorCategory, "specified_person");

  const dbSpecified = await pool.query(
    `SELECT deductor_category::text AS cat FROM users WHERE id = $1`,
    [owner.id]
  );
  assert.equal(dbSpecified.rows[0].cat, "specified_person");

  // 3. Same JWT, no refresh — analyze must immediately use specified_person.
  const liveSpecified = await api("POST", "/compliance/analyze", {
    token: ownerToken,
    body: {
      deductorCategory: "unknown",
      rows: [
        sell("sp-below", 50000),
        sell("sp-above", 50001, {
          date: "2025-06-10T10:00:00+05:30",
          deductorCategory: "other_person",
        }),
      ],
    },
  });
  assert.equal(liveSpecified.status, 200);
  assert.equal(categoryOf(liveSpecified, "sp-below"), "specified_person");
  assert.equal(thresholdOf(liveSpecified, "sp-below").threshold_amount, 50000);
  assert.equal(thresholdOf(liveSpecified, "sp-below").threshold_status, "BELOW_THRESHOLD");
  assert.equal(
    liveSpecified.data.tdsRows.find((r) => r.transactionId === "sp-below").expectedTds,
    0
  );
  assert.equal(categoryOf(liveSpecified, "sp-above"), "specified_person");
  assert.equal(thresholdOf(liveSpecified, "sp-above").threshold_status, "THRESHOLD_CROSSED");
  assert.equal(
    liveSpecified.data.tdsRows.find((r) => r.transactionId === "sp-above").expectedTds,
    500.01
  );

  // 4. Live switch to other_person; same token; CEX + DEX share the new category.
  const savedOther = await api("PATCH", "/profile", {
    token: ownerToken,
    body: { deductorCategory: "other_person" },
  });
  assert.equal(savedOther.data.deductorCategory, "other_person");

  const liveOther = await api("POST", "/compliance/analyze", {
    token: ownerToken,
    body: {
      taxpayerId: other.id,
      userId: other.id,
      deductorCategory: "specified_person",
      rows: [
        sell("op-below", 10000),
        sell("op-above", 10001, {
          date: "2025-06-11T10:00:00+05:30",
          exchange: "Uniswap",
          transactionSource: "DECENTRALIZED_DEX",
          tdsStatus: "NOT_REPORTED",
          deductorCategory: "specified_person",
          taxpayerId: other.id,
        }),
      ],
    },
  });
  assert.equal(categoryOf(liveOther, "op-below"), "other_person");
  assert.equal(thresholdOf(liveOther, "op-below").threshold_amount, 10000);
  assert.equal(thresholdOf(liveOther, "op-below").threshold_status, "BELOW_THRESHOLD");
  assert.equal(
    liveOther.data.tdsRows.find((r) => r.transactionId === "op-below").expectedTds,
    0
  );
  assert.equal(categoryOf(liveOther, "op-above"), "other_person");
  assert.equal(thresholdOf(liveOther, "op-above").threshold_status, "THRESHOLD_CROSSED");
  assert.equal(
    liveOther.data.tdsRows.find((r) => r.transactionId === "op-above").expectedTds,
    100.01
  );
  assert.equal(
    liveOther.data.tdsRows.find((r) => r.transactionId === "op-above").reportedTds,
    null
  );

  // 5. Reset to unknown mid-session and confirm REVIEW_REQUIRED again.
  const savedUnknown = await api("PATCH", "/profile", {
    token: ownerToken,
    body: { deductorCategory: "unknown" },
  });
  assert.equal(savedUnknown.data.deductorCategory, "unknown");
  const liveUnknown = await api("POST", "/compliance/analyze", {
    token: ownerToken,
    body: { rows: [sell("back-to-unknown", 25000)] },
  });
  assert.equal(categoryOf(liveUnknown, "back-to-unknown"), "unknown");
  assert.equal(thresholdOf(liveUnknown, "back-to-unknown").threshold_status, "REVIEW_REQUIRED");
  assert.equal(liveUnknown.data.tdsRows[0].expectedTds, null);

  // 6. Profile ownership: cannot read/update another taxpayer.
  const otherProfile = await api("GET", "/profile", { token: otherToken });
  assert.equal(otherProfile.data.deductorCategory, "other_person");

  const spoofRead = await api("GET", "/profile", { token: ownerToken });
  assert.equal(spoofRead.data.externalId, owner.external_id);
  assert.notEqual(spoofRead.data.externalId, other.external_id);

  const spoofPatch = await api("PATCH", "/profile", {
    token: ownerToken,
    body: {
      deductorCategory: "specified_person",
      userId: other.id,
      taxpayerId: other.id,
      id: other.id,
    },
  });
  assert.equal(spoofPatch.status, 200);
  assert.equal(spoofPatch.data.externalId, owner.external_id);
  assert.equal(spoofPatch.data.deductorCategory, "specified_person");

  const otherUnchanged = await pool.query(
    `SELECT deductor_category::text AS cat FROM users WHERE id = $1`,
    [other.id]
  );
  assert.equal(otherUnchanged.rows[0].cat, "other_person");

  console.log(
    "PASS: E2E taxpayer category flow — unknown→profile save→live DB-backed analyze (CEX/DEX), no JWT refresh required"
  );
} finally {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[owner.id, other.id]]);
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await pool.end();
}
