import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query(`
      ALTER TABLE auditor_requests ADD COLUMN IF NOT EXISTS case_id TEXT REFERENCES cases(id) ON DELETE CASCADE;
    `);
    console.log("auditor_requests case_id added");
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
