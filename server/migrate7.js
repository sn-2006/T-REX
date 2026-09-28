import { pool } from "./src/db.js";

// Adds users.deductor_category for Section 194S (specified_person |
// other_person | unknown). Existing rows receive the column default
// 'unknown' — no inference from PAN, KYC, wallet, or transaction data.
async function run() {
  try {
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE deductor_category AS ENUM (
          'specified_person',
          'other_person',
          'unknown'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS deductor_category deductor_category
        NOT NULL DEFAULT 'unknown';
    `);

    console.log("users.deductor_category added (default unknown)");
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
