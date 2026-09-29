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
      ALTER TABLE auditor_public_keys
        ADD COLUMN IF NOT EXISTS certificate_pem TEXT;

      CREATE TABLE IF NOT EXISTS report_access_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        taxpayer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        auditor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        authorization_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (authorization_status IN ('pending', 'approved', 'revoked')),
        authorized_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        payment_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (payment_status IN ('pending', 'verified', 'failed')),
        payment_reference TEXT UNIQUE,
        payment_provider TEXT,
        payment_event_id TEXT UNIQUE,
        payment_amount_minor BIGINT,
        payment_currency TEXT,
        payment_verified_at TIMESTAMPTZ,
        wrapped_dek TEXT,
        wrapped_dek_key_id TEXT REFERENCES auditor_public_keys(key_id) ON DELETE SET NULL,
        wrapped_dek_released_at TIMESTAMPTZ,
        release_challenge_hash TEXT,
        release_challenge_expires TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (case_id, auditor_id)
      );

      CREATE TABLE IF NOT EXISTS security_audit_events (
        id BIGSERIAL PRIMARY KEY,
        actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        case_id TEXT REFERENCES cases(id) ON DELETE SET NULL,
        auditor_id UUID REFERENCES users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_security_audit_case
        ON security_audit_events(case_id, created_at);
    `);
    console.log("Phase 3 report access, payment, release, and audit schema added");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();