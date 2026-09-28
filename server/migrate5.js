import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query(`
      ALTER TABLE auditor_relationships DROP CONSTRAINT IF EXISTS auditor_relationships_taxpayer_id_auditor_id_key;
    `);
    console.log("auditor_relationships unique index dropped");
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
