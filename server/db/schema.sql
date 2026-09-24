-- ChainTDS database schema
-- Run with: psql "$DATABASE_URL" -f db/schema.sql
--
-- Design notes:
--  - `users` covers all three roles (taxpayer / auditor / regulator). A
--    taxpayer's durable identity is their PAN; auditors/regulators use a
--    fixed staff ID. (role, external_id) is unique together.
--  - `cases` is one taxpayer's finalized, hashed, (optionally) on-chain-
--    anchored reconciliation report — the same "case" object the frontend
--    already builds in src/data/caseStore.js. Its primary key is the
--    report's SHA-256 hash, exactly like the frontend already uses it as
--    the case id and the on-chain anchor key.
--  - `reconciliation`, `discrepancies`, and `insights` are stored as JSONB.
--    These are outputs of the deterministic rule engine (reconcile.js,
--    tdsDiscrepancy.js, evidenceBuilder.js) that already run client-side —
--    they're always read/written as a whole object, never queried by a
--    single nested field in the current app, so JSONB avoids modeling a
--    dozen throwaway tables for shapes that may still evolve. If you later
--    need to query inside them (e.g. "all cases with a TDS_GAP warning"),
--    Postgres can index into JSONB directly with a GIN index — no schema
--    change needed, see the commented example below.
--  - `transactions` IS normalized, because it's the actual source data
--    (parsed exchange CSVs + wallet transfers) that everything else is
--    derived from, and is the one thing worth being able to query/audit
--    row-by-row later (e.g. "every SELL of BTC on Binance in May").

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gives us gen_random_uuid()

CREATE TYPE user_role AS ENUM ('taxpayer', 'auditor', 'regulator');
CREATE TYPE case_status AS ENUM ('pending', 'high-risk', 'flagged', 'verified');
CREATE TYPE kyc_status AS ENUM ('not_submitted', 'pending', 'verified', 'rejected');

-- ---------------------------------------------------------------------------
-- users — replaces the hardcoded DEMO_AUDITORS / DEMO_REGULATORS arrays and
-- the "any PAN is valid" taxpayer login in src/auth/auth.js.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role           user_role NOT NULL,
  external_id    TEXT NOT NULL,   -- PAN for taxpayers, e.g. "AUD001"/"REG001" for staff
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  region         TEXT,            -- taxpayer's declared region (North/South/East/West/Central/North-East); NULL for staff
  email          TEXT,            -- taxpayer's email; NULL for staff
  email_verified BOOLEAN NOT NULL DEFAULT false,
  kyc_status     kyc_status NOT NULL DEFAULT 'not_submitted', -- denormalized from kyc_submissions for a fast gate check on report creation
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, external_id)
);

-- If you already have a running database from before these columns existed:
--   ALTER TABLE users ADD COLUMN region TEXT;
--   ALTER TABLE users ADD COLUMN email TEXT;
--   ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT false;
--   CREATE TYPE kyc_status AS ENUM ('not_submitted', 'pending', 'verified', 'rejected');
--   ALTER TABLE users ADD COLUMN kyc_status kyc_status NOT NULL DEFAULT 'not_submitted';

-- ---------------------------------------------------------------------------
-- email_otps — one-time codes for verifying a taxpayer's email address.
-- Short-lived and single-use; old rows for a user are irrelevant once a
-- newer one is issued, but we don't delete them — they're harmless history.
-- ---------------------------------------------------------------------------
CREATE TABLE email_otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash   TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_otps_user ON email_otps(user_id);

-- ---------------------------------------------------------------------------
-- kyc_submissions — one row per KYC attempt (a taxpayer can resubmit after a
-- rejection, so this is a history, not a single mutable record). The
-- CURRENT status is mirrored onto users.kyc_status so the report-creation
-- gate in routes/cases.js can check it with a single indexed column read
-- instead of a subquery on every submission.
-- ---------------------------------------------------------------------------
CREATE TABLE kyc_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  dob               DATE NOT NULL,
  id_type           TEXT NOT NULL,   -- 'PAN' | 'AADHAAR'
  id_number         TEXT NOT NULL,
  status            kyc_status NOT NULL DEFAULT 'pending',
  rejection_reasons TEXT[] NOT NULL DEFAULT '{}',
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ
);
CREATE INDEX idx_kyc_submissions_user ON kyc_submissions(user_id);

-- ---------------------------------------------------------------------------
-- cases — one row per generated report (== caseStore.js's "case" object).
-- ---------------------------------------------------------------------------
CREATE TABLE cases (
  id                   TEXT PRIMARY KEY,              -- report SHA-256 hash
  taxpayer_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  auditor_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  exchanges            TEXT[] NOT NULL DEFAULT '{}',
  wallets              TEXT[] NOT NULL DEFAULT '{}',
  reconciliation       JSONB NOT NULL,   -- { tradeSummary, transferChecks, warnings, unmatchedDeposits }
  discrepancies        JSONB NOT NULL,   -- computeTdsDiscrepancies() output
  insights             JSONB NOT NULL,   -- buildComplianceInsights() output
  narrative            TEXT,             -- AI-generated plain-language report
  report_hash          TEXT NOT NULL,    -- same value as `id`, kept as its own column for clarity/joins
  anchor_network       TEXT,
  anchor_tx_hash       TEXT,
  anchor_block_number  BIGINT,
  anchor_timestamp     TIMESTAMPTZ,
  verification_url     TEXT,
  status               case_status NOT NULL DEFAULT 'pending',
  review_note          TEXT NOT NULL DEFAULT '',
  is_demo              BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at          TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- transactions — the normalized rows behind `allRows` (parsed CSV rows +
-- wallet transfer rows), one row per uploaded/fetched transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id         BIGSERIAL PRIMARY KEY,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  exchange   TEXT NOT NULL,
  tx_date    DATE NOT NULL,
  type       TEXT NOT NULL,   -- SELL | BUY | WITHDRAWAL | DEPOSIT
  asset      TEXT NOT NULL,
  amount     NUMERIC NOT NULL,
  inr_value  NUMERIC NOT NULL,
  tds_status TEXT NOT NULL,
  tds_amount NUMERIC,
  ref_id     TEXT NOT NULL,
  UNIQUE (case_id, ref_id)
);

CREATE INDEX idx_cases_taxpayer   ON cases(taxpayer_id);
CREATE INDEX idx_cases_auditor    ON cases(auditor_id);
CREATE INDEX idx_cases_status     ON cases(status);
CREATE INDEX idx_transactions_case ON transactions(case_id);

-- Example, if/when you need to query inside the JSONB later:
-- CREATE INDEX idx_cases_reconciliation_gin ON cases USING GIN (reconciliation);
-- Auditor request and private conversation workflow
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS auditor_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auditor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Accepted', 'Rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditor_requests_taxpayer
  ON auditor_requests(taxpayer_id);

CREATE INDEX IF NOT EXISTS idx_auditor_requests_auditor
  ON auditor_requests(auditor_id);

CREATE TABLE IF NOT EXISTS auditor_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auditor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL UNIQUE
    REFERENCES auditor_requests(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (taxpayer_id, auditor_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL UNIQUE
    REFERENCES auditor_relationships(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL
    REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(trim(message)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages(conversation_id, created_at);