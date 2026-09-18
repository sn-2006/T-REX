// Seeds the demo auditor/regulator accounts that used to be hardcoded in
// src/auth/auth.js (DEMO_AUDITORS / DEMO_REGULATORS). Taxpayers don't need
// seeding — they self-register on first login.
//
// Run with: npm run seed   (from the server/ directory)

import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { pool } from "./db.js";

dotenv.config();

const AUDITOR_PASSWORD = process.env.DEMO_AUDITOR_PASSWORD || "auditor123";
const REGULATOR_PASSWORD = process.env.DEMO_REGULATOR_PASSWORD || "regulator123";

const STAFF = [
  { role: "auditor", external_id: "AUD001", name: "Priya Nair", password: AUDITOR_PASSWORD },
  { role: "auditor", external_id: "AUD002", name: "Karan Mehta", password: AUDITOR_PASSWORD },
  { role: "regulator", external_id: "REG001", name: "CBDT Regulatory Desk", password: REGULATOR_PASSWORD },
];

async function main() {
  for (const s of STAFF) {
    const passwordHash = await bcrypt.hash(s.password, 10);
    await pool.query(
      `INSERT INTO users (role, external_id, name, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (role, external_id) DO UPDATE SET name = EXCLUDED.name`,
      [s.role, s.external_id, s.name, passwordHash]
    );
    console.log(`Seeded ${s.role} ${s.external_id}`);
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
