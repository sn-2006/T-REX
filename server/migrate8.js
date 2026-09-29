import { pool } from "./src/db.js";

async function run() {
  try {
    await pool.query(`
      ALTER TABLE cases ADD COLUMN IF NOT EXISTS encrypted_report JSONB;
      CREATE TABLE IF NOT EXISTS auditor_public_keys (
        key_id TEXT PRIMARY KEY,
        auditor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key_spki TEXT NOT NULL,
        certificate_fingerprint TEXT NOT NULL,
        certificate_valid_until TIMESTAMPTZ NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (auditor_id, key_id)
      );
    `);
    console.log("Encrypted report storage and auditor public-key table added; existing plaintext rows were preserved");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();