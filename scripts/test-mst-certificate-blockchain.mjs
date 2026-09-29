import assert from "node:assert/strict";
import {
  ABI,
  isChainConfigured,
  mockIssueCertificateOnChain,
  issueCertificateOnChain,
  verifyCertificateOnChain,
} from "../src/utils/blockchain.js";
import { Interface } from "ethers";

console.log("Testing MST Compliance Certificate blockchain utility integration...");

// 1. Validate Extended ABI Interface
const iface = new Interface(ABI);
assert.ok(iface.getFunction("anchorReport"), "ABI missing anchorReport");
assert.ok(iface.getFunction("verifyReport"), "ABI missing verifyReport");
assert.ok(iface.getFunction("issueComplianceCertificate"), "ABI missing issueComplianceCertificate");
assert.ok(iface.getFunction("getComplianceCertificate"), "ABI missing getComplianceCertificate");
assert.ok(iface.getFunction("getComplianceCertificateById"), "ABI missing getComplianceCertificateById");
assert.ok(iface.getFunction("verifyComplianceCertificate"), "ABI missing verifyComplianceCertificate");
assert.ok(iface.getFunction("revokeComplianceCertificate"), "ABI missing revokeComplianceCertificate");
assert.ok(iface.getEvent("CertificateIssued"), "ABI missing CertificateIssued event");
assert.ok(iface.getEvent("CertificateRevoked"), "ABI missing CertificateRevoked event");
console.log("✓ ABI extended with all compliance certificate functions and events.");

// 2. Test Mock Certificate Issuance
const sampleHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const mockResult = mockIssueCertificateOnChain(sampleHash, "0xAuditorAddress123");
assert.equal(mockResult.reportHash, sampleHash);
assert.ok(mockResult.certId && mockResult.certId.startsWith("0x"));
assert.ok(mockResult.txHash && mockResult.txHash.startsWith("0x"));
assert.equal(mockResult.auditorAddress, "0xAuditorAddress123");
assert.ok(mockResult.timestamp);
console.log("✓ mockIssueCertificateOnChain returns valid certificate metadata.");

// 3. Test Argument Validation on issueCertificateOnChain
try {
  await issueCertificateOnChain({ reportHashHex: "" });
  assert.fail("Should have thrown error on empty report hash");
} catch (err) {
  assert.match(err.message, /valid report hash is required/i);
}
console.log("✓ issueCertificateOnChain validates report hash input.");

// 4. Test verifyCertificateOnChain Config Validation
if (!isChainConfigured) {
  try {
    await verifyCertificateOnChain(sampleHash);
    assert.fail("Should have thrown error when contract not configured");
  } catch (err) {
    assert.match(err.message, /Contract not configured yet/i);
  }
  console.log("✓ verifyCertificateOnChain throws when contract unconfigured.");
}

console.log("All MST Compliance Certificate blockchain utility tests passed successfully!");
