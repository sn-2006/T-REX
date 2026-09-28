import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query(`
      ALTER TABLE auditor_requests ADD COLUMN IF NOT EXISTS pending_close BOOLEAN DEFAULT false;
      ALTER TABLE auditor_requests ADD COLUMN IF NOT EXISTS close_scheduled_at TIMESTAMPTZ;
    `);
    console.log("auditor_requests table altered");
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
