import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";

function issueToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, externalId: user.external_id, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function toSession(user) {
  const base = { role: user.role, id: user.external_id, name: user.name };
  return user.role === "taxpayer"
    ? {
        ...base,
        panMasked: user.external_id,
        region: user.region,
        emailVerified: user.email_verified,
        kycStatus: user.kyc_status,
      }
    : base;
}

const REGIONS = ["North", "South", "East", "West", "Central", "North-East"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Taxpayers aren't pre-known to the system — anyone can be a taxpayer — so
// this endpoint doubles as register-or-login: first time a PAN is seen it
// creates the account (password becomes that PAN's login going forward);
// every time after, it's a normal password check. This mirrors the original
// mock behavior in src/auth/auth.js, just backed by real, persisted
// credentials instead of "any PAN + name works."
// ---------------------------------------------------------------------------
router.post("/taxpayer", async (req, res) => {
  const pan = (req.body.pan || "").trim().toUpperCase();
  const name = (req.body.name || "").trim();
  const password = req.body.password || "";
  const region = (req.body.region || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();

  if (!pan || pan.length < 4) return res.status(400).json({ error: "Enter a valid PAN to continue." });
  if (!name) return res.status(400).json({ error: "Enter your name to continue." });
  if (!password || password.length < 4)
    return res.status(400).json({ error: "Password must be at least 4 characters." });

  try {
    const existing = await pool.query(
      "SELECT * FROM users WHERE role = 'taxpayer' AND external_id = $1",
      [pan]
    );

    let user;
    if (existing.rows.length === 0) {
      // First time this PAN is seen — region is required so the regulator
      // dashboard can break taxpayers down region-wise from day one, and
      // email is required so there's something to run email verification
      // against right after signup.
      if (!region || !REGIONS.includes(region)) {
        return res.status(400).json({ error: "Select your region to continue." });
      }
      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: "Enter a valid email to continue." });
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const inserted = await pool.query(
        `INSERT INTO users (role, external_id, name, password_hash, region, email)
         VALUES ('taxpayer', $1, $2, $3, $4, $5) RETURNING *`,
        [pan, name, passwordHash, region, email]
      );
      user = inserted.rows[0];
    } else {
      user = existing.rows[0];

      // An existing PAN is allowed to sign in again only when the submitted
      // identity details match the account already stored for that PAN.
      // This prevents duplicate accounts while still allowing the original
      // user to continue through the normal email-OTP verification flow.
      const normalizeName = (value) =>
        String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

      const nameMatches = normalizeName(user.name) === normalizeName(name);
      const emailMatches =
        String(user.email || "").trim().toLowerCase() === email;
      const regionMatches = String(user.region || "").trim() === region;

      if (!nameMatches || !emailMatches || !regionMatches) {
        return res.status(409).json({
          error:
            "An account with this PAN already exists, but the submitted details do not match the existing account.",
        });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      // Wrong password: reject outright — no token is issued and no login
      // is allowed to proceed.
      if (!ok) return res.status(401).json({ error: "Incorrect password for this PAN." });
    }

    res.json({ token: issueToken(user), session: toSession(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed — try again." });
  }
});

// Auditors and regulators are internal roles: accounts must already exist
// (created via `npm run seed`, or by hand) — this is login-only, no
// self-registration.
function staffLogin(role) {
  return async (req, res) => {
    const id = (req.body.id || "").trim().toUpperCase();
    const password = req.body.password || "";

    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE role = $1 AND external_id = $2",
        [role, id]
      );
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: `Invalid ${role} ID or password.` });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: `Invalid ${role} ID or password.` });

      res.json({ token: issueToken(user), session: toSession(user) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Login failed — try again." });
    }
  };
}

router.post("/auditor", staffLogin("auditor"));
router.post("/regulator", staffLogin("regulator"));

export default router;