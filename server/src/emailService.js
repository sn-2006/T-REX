import nodemailer from "nodemailer";

// Real email, same "mock unless configured" pattern as isWalletApiConfigured
// / isChainConfigured elsewhere in this codebase: with SMTP_HOST/SMTP_USER/
// SMTP_PASS set in server/.env, this sends an actual email over real SMTP.
// Without them, it falls back to logging the OTP to the server console and
// returning it in the API response (see routes/verification.js) so the demo
// stays completable without a real inbox.
//
// Quick setup with a free Gmail account (works for a prototype/demo — for
// anything production-facing, use a transactional provider like Brevo,
// SendGrid, Resend, or Postmark instead of a personal Gmail account):
//   1. Turn on 2-Step Verification on the Google account:
//        https://myaccount.google.com/security
//   2. Create an "App password": https://myaccount.google.com/apppasswords
//      (Google no longer allows your normal password for SMTP logins.)
//   3. In server/.env:
//        SMTP_HOST=smtp.gmail.com
//        SMTP_PORT=465
//        SMTP_SECURE=true
//        SMTP_USER=youraddress@gmail.com
//        SMTP_PASS=<the 16-character App Password, no spaces>
//        SMTP_FROM="ChainTDS <youraddress@gmail.com>"
//   4. Restart the server. isEmailConfigured flips to true automatically.
//
// Any other SMTP provider works the same way — just point SMTP_HOST/PORT/
// SECURE at their server instead of Gmail's.

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true"; // true for port 465, false for 587/25
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

export const isEmailConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendOtpEmail(to, otp) {
  const subject = "Your ChainTDS verification code";
  const text = `Your ChainTDS email verification code is ${otp}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family: sans-serif; font-size: 15px; color: #111;">
      <p>Your ChainTDS email verification code is:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 4px;">${otp}</p>
      <p style="color: #666;">It expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>`;

  if (!isEmailConfigured) {
    // eslint-disable-next-line no-console
    console.log(`[ChainTDS] (mock email — no SMTP configured) To: ${to} | OTP: ${otp}`);
    return { sent: true, mode: "mock" };
  }

  try {
    await getTransporter().sendMail({ from: SMTP_FROM, to, subject, text, html });
    return { sent: true, mode: "smtp" };
  } catch (err) {
    console.error("Failed to send verification email:", err);
    // Surface a clear, actionable error instead of a raw nodemailer stack —
    // the two most common causes by far are a wrong app password or the
    // Google account not having 2-Step Verification turned on yet.
    throw new Error(
      "Couldn't send the verification email. Double-check SMTP_USER/SMTP_PASS in server/.env " +
        "(for Gmail, SMTP_PASS must be an App Password, not your normal password)."
    );
  }
}
