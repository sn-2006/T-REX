import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query("ALTER TABLE auditor_requests DROP CONSTRAINT auditor_requests_status_check;");
    await pool.query("ALTER TABLE auditor_requests ADD CONSTRAINT auditor_requests_status_check CHECK (status IN ('Pending', 'Accepted', 'Rejected', 'Closed'));");
    console.log("Success");
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

run();
