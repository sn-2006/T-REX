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
const profileRoutes = (await import("../server/src/routes/profile.js")).default;

const JWT_SECRET = process.env.JWT_SECRET;
assert.ok(JWT_SECRET, "JWT_SECRET must be set in server/.env for profile API tests");

const app = express();
app.use(express.json());
app.use("/api/profile", profileRoutes);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api/profile`;

const stamp = Date.now().toString(36).toUpperCase();
const panA = `AAAPA${stamp}`.slice(0, 10);
const panB = `BBBPB${stamp}`.slice(0, 10);
const passwordHash = await bcrypt.hash("test-pass", 4);

const inserted = await pool.query(
  `INSERT INTO users (role, external_id, name, password_hash, region, email, deductor_category)
   VALUES
     ('taxpayer', $1, 'Profile Test A', $3, 'South', $4, 'unknown'),
     ('taxpayer', $2, 'Profile Test B', $3, 'North', $5, 'other_person')
   RETURNING id, external_id, deductor_category`,
  [
    panA,
    panB,
    passwordHash,
    `a_${stamp}@example.com`,
    `b_${stamp}@example.com`,
  ]
);

const userA = inserted.rows[0];
const userB = inserted.rows[1];

function tokenFor(user, role = "taxpayer") {
  return jwt.sign(
    { id: user.id, role, externalId: user.external_id, name: "Profile Test" },
    JWT_SECRET,
    { expiresIn: "10m" }
  );
}

async function request(method, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(baseUrl, {
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

try {
  const unauth = await request("GET");
  assert.equal(unauth.status, 401);

  const auditorTok = jwt.sign(
    { id: userA.id, role: "auditor", externalId: "AUDTEST", name: "Auditor" },
    JWT_SECRET,
    { expiresIn: "10m" }
  );
  const forbidden = await request("GET", { token: auditorTok });
  assert.equal(forbidden.status, 403);

  const tokenA = tokenFor(userA);
  const tokenB = tokenFor(userB);

  const readA = await request("GET", { token: tokenA });
  assert.equal(readA.status, 200);
  assert.equal(readA.data.deductorCategory, "unknown");
  assert.equal(readA.data.externalId, userA.external_id);

  for (const category of ["specified_person", "other_person", "unknown"]) {
    const updated = await request("PATCH", {
      token: tokenA,
      body: { deductorCategory: category },
    });
    assert.equal(updated.status, 200, `PATCH ${category}`);
    assert.equal(updated.data.deductorCategory, category);

    const reread = await request("GET", { token: tokenA });
    assert.equal(reread.data.deductorCategory, category);
  }

  const invalid = await request("PATCH", {
    token: tokenA,
    body: { deductorCategory: "not_valid" },
  });
  assert.equal(invalid.status, 400);

  const missing = await request("PATCH", {
    token: tokenA,
    body: {},
  });
  assert.equal(missing.status, 400);

  // Spoofing another user's id in the body must not change that other user.
  const beforeB = await pool.query(
    `SELECT deductor_category::text AS cat FROM users WHERE id = $1`,
    [userB.id]
  );
  assert.equal(beforeB.rows[0].cat, "other_person");

  const spoof = await request("PATCH", {
    token: tokenA,
    body: {
      deductorCategory: "specified_person",
      userId: userB.id,
      taxpayerId: userB.id,
      id: userB.id,
    },
  });
  assert.equal(spoof.status, 200);
  assert.equal(spoof.data.deductorCategory, "specified_person");
  assert.equal(spoof.data.externalId, userA.external_id);

  const afterB = await pool.query(
    `SELECT deductor_category::text AS cat FROM users WHERE id = $1`,
    [userB.id]
  );
  assert.equal(afterB.rows[0].cat, "other_person");

  const afterA = await pool.query(
    `SELECT deductor_category::text AS cat FROM users WHERE id = $1`,
    [userA.id]
  );
  assert.equal(afterA.rows[0].cat, "specified_person");

  const readB = await request("GET", { token: tokenB });
  assert.equal(readB.status, 200);
  assert.equal(readB.data.deductorCategory, "other_person");

  console.log("PASS: taxpayer profile GET/PATCH ownership, validation, and auth gates");
} finally {
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
    [userA.id, userB.id],
  ]);
  await new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
  await pool.end();
}
