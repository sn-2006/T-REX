import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendOtpEmail } from "../emailService.js";
import { evaluateKyc, isKycProviderConfigured } from "../kycService.js";
import { isEmailConfigured } from "../emailService.js";

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MINUTES = 10;
const ID_TYPES = ["PAN", "AADHAAR"];

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits, always
}

// GET /api/verification/status — everything the "verify your account" page
// needs to render: current email, whether it's verified, and the KYC
// state (plus rejection reasons, if any, from the most recent submission).
router.get("/status", requireAuth, requireRole("taxpayer"), async (req, res) => {
  const userResult = await pool.query(
    "SELECT email, email_verified, kyc_status FROM users WHERE id = $1",
    [req.user.id]
  );
  const user = userResult.rows[0];

  const latestKyc = await pool.query(
    `SELECT full_name, dob, id_type, id_number, status, rejection_reasons, submitted_at
     FROM kyc_submissions WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`,
    [req.user.id]
  );

  res.json({
    email: user.email,
    emailVerified: user.email_verified,
    emailConfigured: isEmailConfigured,
    kycStatus: user.kyc_status,
    kycProviderConfigured: isKycProviderConfigured,
    kycLatestSubmission: latestKyc.rows[0] || null,
  });
});

// POST /api/verification/email/send-otp — { email }
router.post("/email/send-otp", requireAuth, requireRole("taxpayer"), async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Changing the email (or re-sending to the same one) always resets
    // verification — an unverified new address must never inherit a
    // previous address's verified status.
    await client.query("UPDATE users SET email = $1, email_verified = false WHERE id = $2", [
      email,
      req.user.id,
    ]);

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await client.query(
      "INSERT INTO email_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, $3)",
      [req.user.id, otpHash, expiresAt]
    );

    await client.query("COMMIT");

    const sendResult = await sendOtpEmail(email, otp);

    res.json({
      sent: true,
      expiresInMinutes: OTP_TTL_MINUTES,
      // Only present when no real SMTP is configured — see emailService.js.
      // Lets the demo actually be completable without a real inbox, while
      // making unmistakably clear that this is standing in for a real send.
      devOtp: sendResult.mode === "mock" ? otp : undefined,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't send a verification code — try again." });
  } finally {
    client.release();
  }
});

// POST /api/verification/email/verify-otp — { otp }
router.post("/email/verify-otp", requireAuth, requireRole("taxpayer"), async (req, res) => {
  const otp = (req.body.otp || "").trim();
  if (!otp) return res.status(400).json({ error: "Enter the code from your email." });

  const result = await pool.query(
    `SELECT * FROM email_otps
     WHERE user_id = $1 AND consumed = false AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  const record = result.rows[0];
  if (!record) {
    return res.status(400).json({ error: "That code has expired — send a new one and try again." });
  }

  const ok = await bcrypt.compare(otp, record.otp_hash);
  if (!ok) return res.status(400).json({ error: "Incorrect code — check your email and try again." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE email_otps SET consumed = true WHERE id = $1", [record.id]);
    await client.query("UPDATE users SET email_verified = true WHERE id = $1", [req.user.id]);
    await client.query("COMMIT");
    res.json({ emailVerified: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't verify that code — try again." });
  } finally {
    client.release();
  }
});

// POST /api/verification/kyc — { fullName, dob, idType, idNumber }
router.post("/kyc", requireAuth, requireRole("taxpayer"), async (req, res) => {
  const fullName = (req.body.fullName || "").trim();
  const dob = req.body.dob;
  const idType = (req.body.idType || "").trim().toUpperCase();
  const idNumber = (req.body.idNumber || "").trim();

  if (!fullName || !dob || !ID_TYPES.includes(idType) || !idNumber) {
    return res.status(400).json({ error: "Fill in every KYC field before submitting." });
  }

  const { status, reasons } = await evaluateKyc({
    fullName,
    dob,
    idType,
    idNumber,
    panOnRecord: req.user.externalId, // taxpayer's login PAN — cross-checked when idType is PAN
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO kyc_submissions (user_id, full_name, dob, id_type, id_number, status, rejection_reasons, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [req.user.id, fullName, dob, idType, idNumber.toUpperCase(), status, reasons]
    );
    await client.query("UPDATE users SET kyc_status = $1 WHERE id = $2", [status, req.user.id]);

    await client.query("COMMIT");
    res.json({ status, reasons });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Couldn't submit KYC — try again." });
  } finally {
    client.release();
  }
});

export default router;
