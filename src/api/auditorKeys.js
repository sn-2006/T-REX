import { apiFetch } from "./client.js";
import { buildAuditorKeyRegistrationBody } from "../utils/reportCrypto.js";

export function registerAuditorPublicKey({ keyPair, certificatePem }) {
  return apiFetch("/auditor-keys", {
    method: "POST",
    body: buildAuditorKeyRegistrationBody({ keyPair, certificatePem }),
  });
}