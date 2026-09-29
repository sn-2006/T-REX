const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ChainTDSRegistry", function () {
  let contract;
  let owner;
  let auditor;
  let nonAuditor;
  let taxpayer;

  const sampleReportHash = ethers.keccak256(ethers.toUtf8Bytes("sample-report-data-1"));
  const secondReportHash = ethers.keccak256(ethers.toUtf8Bytes("sample-report-data-2"));

  beforeEach(async function () {
    [owner, auditor, nonAuditor, taxpayer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ChainTDSRegistry");
    contract = await Factory.deploy();
    await contract.waitForDeployment();

    // Authorize `auditor` address
    await contract.connect(owner).setAuditorAuthorization(auditor.address, true);
  });

  describe("Anchoring Reports (Existing Functionality)", function () {
    it("anchors a report hash successfully and verifies it", async function () {
      await expect(contract.connect(taxpayer).anchorReport(sampleReportHash))
        .to.emit(contract, "ReportAnchored");

      const [found, submitter, timestamp] = await contract.verifyReport(sampleReportHash);
      expect(found).to.be.true;
      expect(submitter).to.equal(taxpayer.address);
      expect(timestamp).to.be.gt(0);
    });

    it("reverts on duplicate report anchoring", async function () {
      await contract.connect(taxpayer).anchorReport(sampleReportHash);
      await expect(
        contract.connect(taxpayer).anchorReport(sampleReportHash)
      ).to.be.revertedWith("Report already anchored");
    });
  });

  describe("Compliance Certificate Functionality", function () {
    it("allows authorized auditor to issue a certificate and emits CertificateIssued event", async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 86400 * 365;
      const status = 1; // Verified

      await expect(
        contract
          .connect(auditor)
          .issueComplianceCertificate(sampleReportHash, taxpayer.address, status, validUntil)
      )
        .to.emit(contract, "CertificateIssued")
        .withArgs(
          (certId) => certId !== ethers.ZeroHash,
          sampleReportHash,
          auditor.address,
          taxpayer.address,
          status,
          (ts) => ts > 0,
          validUntil
        );
    });

    it("retrieves an issued certificate by report hash and by certId", async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 86400 * 365;
      const status = 1;

      const tx = await contract
        .connect(auditor)
        .issueComplianceCertificate(sampleReportHash, taxpayer.address, status, validUntil);
      const receipt = await tx.wait();

      const certEvent = receipt.logs
        .map((log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === "CertificateIssued");

      const certId = certEvent.args.certId;

      // Retrieval by report hash
      const certByHash = await contract.getComplianceCertificate(sampleReportHash);
      expect(certByHash.certId).to.equal(certId);
      expect(certByHash.auditor).to.equal(auditor.address);
      expect(certByHash.taxpayer).to.equal(taxpayer.address);
      expect(certByHash.status).to.equal(status);
      expect(certByHash.exists).to.be.true;

      // Retrieval by certificate ID
      const certById = await contract.getComplianceCertificateById(certId);
      expect(certById.reportHash).to.equal(sampleReportHash);
      expect(certById.auditor).to.equal(auditor.address);
      expect(certById.exists).to.be.true;
    });

    it("verifies an active certificate cleanly", async function () {
      const validUntil = Math.floor(Date.now() / 1000) + 86400;
      await contract
        .connect(auditor)
        .issueComplianceCertificate(sampleReportHash, taxpayer.address, 1, validUntil);

      const [valid, certAuditor, status, issuedAt, certValidUntil, revoked] =
        await contract.verifyComplianceCertificate(sampleReportHash);

      expect(valid).to.be.true;
      expect(certAuditor).to.equal(auditor.address);
      expect(status).to.equal(1);
      expect(revoked).to.be.false;
      expect(issuedAt).to.be.gt(0);
      expect(certValidUntil).to.equal(validUntil);
    });

    it("prevents duplicate certificates for the same report hash", async function () {
      await contract
        .connect(auditor)
        .issueComplianceCertificate(sampleReportHash, taxpayer.address, 1, 0);

      await expect(
        contract
          .connect(auditor)
          .issueComplianceCertificate(sampleReportHash, taxpayer.address, 1, 0)
      ).to.be.revertedWith("Certificate already issued for this report");
    });

    it("reverts when unauthorized wallet attempts to issue a certificate", async function () {
      await expect(
        contract
          .connect(nonAuditor)
          .issueComplianceCertificate(secondReportHash, taxpayer.address, 1, 0)
      ).to.be.revertedWith("Caller is not an authorized auditor");
    });

    it("allows issuing auditor to revoke a certificate and emits CertificateRevoked event", async function () {
      await contract
        .connect(auditor)
        .issueComplianceCertificate(sampleReportHash, taxpayer.address, 1, 0);

      await expect(
        contract
          .connect(auditor)
          .revokeComplianceCertificate(sampleReportHash, "Non-compliant activity detected")
      )
        .to.emit(contract, "CertificateRevoked")
        .withArgs(
          (certId) => certId !== ethers.ZeroHash,
          sampleReportHash,
          auditor.address,
          "Non-compliant activity detected"
        );
    });

    it("fails verification for a revoked certificate", async function () {
      await contract
        .connect(auditor)
        .issueComplianceCertificate(sampleReportHash, taxpayer.address, 1, 0);

      await contract
        .connect(auditor)
        .revokeComplianceCertificate(sampleReportHash, "Discrepancy audit failed");

      const [valid, , , , , revoked] = await contract.verifyComplianceCertificate(sampleReportHash);
      expect(valid).to.be.false;
      expect(revoked).to.be.true;

      const cert = await contract.getComplianceCertificate(sampleReportHash);
      expect(cert.revocationReason).to.equal("Discrepancy audit failed");
    });

    it("reverts on double revocation", async function () {
      await contract
        .connect(auditor)
        .issueComplianceCertificate(sampleReportHash, taxpayer.address, 1, 0);

      await contract.connect(auditor).revokeComplianceCertificate(sampleReportHash, "Initial reason");

      await expect(
        contract.connect(auditor).revokeComplianceCertificate(sampleReportHash, "Second attempt")
      ).to.be.revertedWith("Certificate already revoked");
    });
  });
});
