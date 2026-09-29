import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query(`
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS certificate_id TEXT;
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS certificate_tx_hash TEXT;
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS certificate_block_number BIGINT;
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS certificate_issued_at TIMESTAMPTZ;
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS certificate_auditor_address TEXT;
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS certificate_status TEXT;
    `);
    console.log("Migration 10: MST Compliance Certificate columns added to cases table successfully.");
  } catch (error) {
    console.error("Migration 10 failed (database may be offline or unreachable):", error.message);
  } finally {
    await pool.end();
  }
}

run();
