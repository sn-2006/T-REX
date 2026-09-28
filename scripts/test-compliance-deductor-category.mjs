import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../server/.env") });

const { pool } = await import("../server/src/db.js");
const complianceRoutes = (await import("../server/src/routes/compliance.js")).default;

const JWT_SECRET = process.env.JWT_SECRET;
assert.ok(
  JWT_SECRET,
  "JWT_SECRET must be set in server/.env for compliance category integration tests"
);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api/compliance", complianceRoutes);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const analyzeUrl = `http://127.0.0.1:${port}/api/compliance/analyze`;

const stamp = Date.now().toString(36).toUpperCase();
const passwordHash = await bcrypt.hash("test-pass", 4);

const inserted = await pool.query(
  `INSERT INTO users (role, external_id, name, password_hash, region, email, deductor_category)
   VALUES
     ('taxpayer', $1, 'Compliance Cat A', $4, 'South', $5, 'specified_person'),
     ('taxpayer', $2, 'Compliance Cat B', $4, 'North', $6, 'other_person'),
     ('taxpayer', $3, 'Compliance Cat C', $4, 'West', $7, 'unknown')
   RETURNING id, external_id, deductor_category::text AS deductor_category`,
  [
    `CCA${stamp}`.slice(0, 10),
    `CCB${stamp}`.slice(0, 10),
    `CCC${stamp}`.slice(0, 10),
    passwordHash,
    `cca_${stamp}@example.com`,
    `ccb_${stamp}@example.com`,
    `ccc_${stamp}@example.com`,
  ]
);

const [userSpecified, userOther, userUnknown] = inserted.rows;

function tokenFor(user) {
  return jwt.sign(
    {
      id: user.id,
      role: "taxpayer",
      externalId: user.external_id,
      name: "Compliance Cat Test",
      // Deliberately wrong JWT claim — must not be trusted over the DB.
      deductorCategory: "other_person",
    },
    JWT_SECRET,
    { expiresIn: "10m" }
  );
}

function sell({ refId, amount, date = "2025-05-10T10:00:00+05:30", overrides = {} }) {
  return {
    refId,
    date,
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

async function analyze(token, body) {
  const res = await fetch(analyzeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

function rowByRef(result, refId) {
  return result.data.rows.find((row) => row.refId === refId);
}

try {
  // specified_person → ₹50,000 threshold
  const specified = await analyze(tokenFor(userSpecified), {
    rows: [sell({ refId: "sp-cross", amount: 50001 })],
  });
  assert.equal(specified.status, 200);
  assert.equal(rowByRef(specified, "sp-cross").threshold_amount, 50000);
  assert.equal(rowByRef(specified, "sp-cross").threshold_status, "THRESHOLD_CROSSED");
  assert.equal(rowByRef(specified, "sp-cross").financialYearAggregation.deductorCategory, "specified_person");
  assert.equal(specified.data.tdsRows[0].expectedTds, 500.01);

  const specifiedBelow = await analyze(tokenFor(userSpecified), {
    rows: [sell({ refId: "sp-below", amount: 49999 })],
  });
  assert.equal(rowByRef(specifiedBelow, "sp-below").threshold_status, "BELOW_THRESHOLD");
  assert.equal(specifiedBelow.data.tdsRows[0].expectedTds, 0);

  // other_person → ₹10,000 threshold
  const other = await analyze(tokenFor(userOther), {
    rows: [sell({ refId: "op-cross", amount: 10001 })],
  });
  assert.equal(other.status, 200);
  assert.equal(rowByRef(other, "op-cross").threshold_amount, 10000);
  assert.equal(rowByRef(other, "op-cross").threshold_status, "THRESHOLD_CROSSED");
  assert.equal(rowByRef(other, "op-cross").financialYearAggregation.deductorCategory, "other_person");
  assert.equal(other.data.tdsRows[0].expectedTds, 100.01);

  // unknown → REVIEW_REQUIRED
  const unknown = await analyze(tokenFor(userUnknown), {
    rows: [sell({ refId: "unk-sale", amount: 20000 })],
  });
  assert.equal(unknown.status, 200);
  assert.equal(rowByRef(unknown, "unk-sale").threshold_status, "REVIEW_REQUIRED");
  assert.equal(rowByRef(unknown, "unk-sale").is_194s_applicable, null);
  assert.equal(rowByRef(unknown, "unk-sale").financialYearAggregation.deductorCategory, "unknown");
  assert.equal(unknown.data.tdsRows[0].expectedTds, null);

  // Body-level client override must not win over the DB (userSpecified).
  const bodyOverride = await analyze(tokenFor(userSpecified), {
    deductorCategory: "unknown",
    userId: userUnknown.id,
    taxpayerId: userUnknown.id,
    rows: [sell({ refId: "body-override", amount: 50001 })],
  });
  assert.equal(
    rowByRef(bodyOverride, "body-override").financialYearAggregation.deductorCategory,
    "specified_person"
  );
  assert.equal(rowByRef(bodyOverride, "body-override").threshold_amount, 50000);
  assert.equal(rowByRef(bodyOverride, "body-override").threshold_status, "THRESHOLD_CROSSED");

  // Per-row client override must not win over the DB.
  const rowOverride = await analyze(tokenFor(userOther), {
    rows: [
      sell({
        refId: "row-override",
        amount: 10001,
        overrides: { deductorCategory: "specified_person" },
      }),
    ],
  });
  assert.equal(
    rowByRef(rowOverride, "row-override").financialYearAggregation.deductorCategory,
    "other_person"
  );
  assert.equal(rowByRef(rowOverride, "row-override").threshold_amount, 10000);

  // Taxpayer A cannot cause taxpayer B's category to be used.
  const crossUser = await analyze(tokenFor(userSpecified), {
    taxpayerId: userOther.id,
    userId: userOther.id,
    rows: [
      sell({
        refId: "cross-user",
        amount: 20000,
        overrides: { taxpayerId: userOther.id, deductorCategory: "other_person" },
      }),
    ],
  });
  assert.equal(
    rowByRef(crossUser, "cross-user").financialYearAggregation.deductorCategory,
    "specified_person"
  );
  assert.equal(rowByRef(crossUser, "cross-user").threshold_amount, 50000);
  assert.equal(rowByRef(crossUser, "cross-user").threshold_status, "BELOW_THRESHOLD");

  // Existing CEX path still works with DB-backed category.
  const cex = await analyze(tokenFor(userOther), {
    rows: [
      sell({ refId: "cex-1", amount: 6000, date: "2025-04-02T10:00:00+05:30" }),
      sell({ refId: "cex-2", amount: 5000, date: "2025-05-02T10:00:00+05:30" }),
    ],
  });
  assert.equal(rowByRef(cex, "cex-1").threshold_status, "BELOW_THRESHOLD");
  assert.equal(rowByRef(cex, "cex-2").threshold_status, "THRESHOLD_CROSSED");
  assert.equal(cex.data.tdsRows.find((r) => r.transactionId === "cex-2").expectedTds, 50);

  // Normalized DEX rows use the same DB-backed category path.
  const dex = await analyze(tokenFor(userOther), {
    rows: [
      sell({
        refId: "dex-sale",
        amount: 15000,
        overrides: {
          exchange: "Uniswap",
          transactionSource: "DECENTRALIZED_DEX",
          tdsStatus: "NOT_REPORTED",
        },
      }),
    ],
  });
  assert.equal(rowByRef(dex, "dex-sale").threshold_status, "THRESHOLD_CROSSED");
  assert.equal(rowByRef(dex, "dex-sale").financialYearAggregation.deductorCategory, "other_person");
  assert.equal(dex.data.tdsRows[0].expectedTds, 150);
  assert.equal(dex.data.tdsRows[0].reportedTds, null);
  assert.equal(dex.data.tdsRows[0].status, "REVIEW_REQUIRED");

  const unauth = await fetch(analyzeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: [] }),
  });
  assert.equal(unauth.status, 401);

  console.log(
    "PASS: compliance analyze loads DB deductor_category, blocks client overrides, and keeps CEX/DEX 194S path"
  );
} finally {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
    [userSpecified.id, userOther.id, userUnknown.id],
  ]);
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await pool.end();
}
