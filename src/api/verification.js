import { apiFetch } from "./client.js";

export async function fetchVerificationStatus() {
  return apiFetch("/verification/status");
}

export async function sendEmailOtp(email) {
  return apiFetch("/verification/email/send-otp", { method: "POST", body: { email } });
}

export async function verifyEmailOtp(otp) {
  return apiFetch("/verification/email/verify-otp", { method: "POST", body: { otp } });
}

export async function submitKyc({ fullName, dob, idType, idNumber }) {
  return apiFetch("/verification/kyc", {
    method: "POST",
    body: { fullName, dob, idType, idNumber },
  });
}
