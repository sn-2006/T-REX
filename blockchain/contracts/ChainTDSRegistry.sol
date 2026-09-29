// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ChainTDSRegistry
/// @notice Anchors the SHA-256 fingerprint of a ChainTDS reconciliation report on-chain,
/// and lets authorized auditors issue, verify, and revoke compliance certificates.
/// The contract never stores sensitive report contents or financial data — only non-sensitive metadata hashes and addresses.
contract ChainTDSRegistry {
    address public owner;

    mapping(address => bool) public authorizedAuditors;

    struct Anchor {
        address submitter;
        uint256 timestamp;
        bool exists;
    }

    struct Certificate {
        bytes32 certId;
        bytes32 reportHash;
        address auditor;
        address taxpayer;
        uint8 status; // e.g. 1 = Verified, 2 = Flagged, 3 = HighRisk
        uint256 issuedAt;
        uint256 validUntil; // 0 = no expiration
        bool revoked;
        string revocationReason;
        bool exists;
    }

    mapping(bytes32 => Anchor) private anchors;
    mapping(bytes32 => Certificate) private certificatesByReport;
    mapping(bytes32 => Certificate) private certificatesById;

    event ReportAnchored(bytes32 indexed reportHash, address indexed submitter, uint256 timestamp);
    event AuditorAuthorized(address indexed auditor, bool authorized);
    event CertificateIssued(
        bytes32 indexed certId,
        bytes32 indexed reportHash,
        address indexed auditor,
        address taxpayer,
        uint8 status,
        uint256 issuedAt,
        uint256 validUntil
    );
    event CertificateRevoked(
        bytes32 indexed certId,
        bytes32 indexed reportHash,
        address indexed auditor,
        string reason
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can perform this action");
        _;
    }

    modifier onlyAuditor() {
        require(authorizedAuditors[msg.sender], "Caller is not an authorized auditor");
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedAuditors[msg.sender] = true;
        emit AuditorAuthorized(msg.sender, true);
    }

    /// @notice Grants or revokes auditor authorization.
    function setAuditorAuthorization(address auditor, bool authorized) external onlyOwner {
        require(auditor != address(0), "Invalid auditor address");
        authorizedAuditors[auditor] = authorized;
        emit AuditorAuthorized(auditor, authorized);
    }

    /// @notice Anchors a report hash. Reverts if this exact hash was already
    /// anchored, so a report can't be silently re-anchored with a new
    /// timestamp later.
    /// @param reportHash The SHA-256 hash of the reconciliation report.
    function anchorReport(bytes32 reportHash) external {
        require(!anchors[reportHash].exists, "Report already anchored");

        anchors[reportHash] = Anchor({
            submitter: msg.sender,
            timestamp: block.timestamp,
            exists: true
        });

        emit ReportAnchored(reportHash, msg.sender, block.timestamp);
    }

    /// @notice Read-only check — costs no gas to call. Returns whether the
    /// hash was anchored, by whom, and when.
    function verifyReport(bytes32 reportHash)
        external
        view
        returns (bool found, address submitter, uint256 timestamp)
    {
        Anchor memory a = anchors[reportHash];
        return (a.exists, a.submitter, a.timestamp);
    }

    /// @notice Issues an on-chain compliance certificate for an anchored report.
    /// Only callable by authorized auditors. Prevents duplicate certificates for the same report hash.
    function issueComplianceCertificate(
        bytes32 reportHash,
        address taxpayer,
        uint8 status,
        uint256 validUntil
    ) external onlyAuditor returns (bytes32 certId) {
        require(reportHash != bytes32(0), "Invalid report hash");
        require(!certificatesByReport[reportHash].exists, "Certificate already issued for this report");

        certId = keccak256(abi.encodePacked(reportHash, msg.sender, block.timestamp));

        Certificate memory cert = Certificate({
            certId: certId,
            reportHash: reportHash,
            auditor: msg.sender,
            taxpayer: taxpayer,
            status: status,
            issuedAt: block.timestamp,
            validUntil: validUntil,
            revoked: false,
            revocationReason: "",
            exists: true
        });

        certificatesByReport[reportHash] = cert;
        certificatesById[certId] = cert;

        emit CertificateIssued(certId, reportHash, msg.sender, taxpayer, status, block.timestamp, validUntil);
        return certId;
    }

    /// @notice Returns the compliance certificate details by report hash.
    function getComplianceCertificate(bytes32 reportHash)
        external
        view
        returns (
            bytes32 certId,
            bytes32 reportHashOut,
            address auditor,
            address taxpayer,
            uint8 status,
            uint256 issuedAt,
            uint256 validUntil,
            bool revoked,
            string memory revocationReason,
            bool exists
        )
    {
        Certificate memory c = certificatesByReport[reportHash];
        return (
            c.certId,
            c.reportHash,
            c.auditor,
            c.taxpayer,
            c.status,
            c.issuedAt,
            c.validUntil,
            c.revoked,
            c.revocationReason,
            c.exists
        );
    }

    /// @notice Returns the compliance certificate details by certificate ID.
    function getComplianceCertificateById(bytes32 certId)
        external
        view
        returns (
            bytes32 certIdOut,
            bytes32 reportHash,
            address auditor,
            address taxpayer,
            uint8 status,
            uint256 issuedAt,
            uint256 validUntil,
            bool revoked,
            string memory revocationReason,
            bool exists
        )
    {
        Certificate memory c = certificatesById[certId];
        return (
            c.certId,
            c.reportHash,
            c.auditor,
            c.taxpayer,
            c.status,
            c.issuedAt,
            c.validUntil,
            c.revoked,
            c.revocationReason,
            c.exists
        );
    }

    /// @notice Validates whether a compliance certificate for a report hash is active, unrevoked, and unexpired.
    function verifyComplianceCertificate(bytes32 reportHash)
        external
        view
        returns (
            bool valid,
            address auditor,
            uint8 status,
            uint256 issuedAt,
            uint256 validUntil,
            bool revoked
        )
    {
        Certificate memory c = certificatesByReport[reportHash];
        bool isNotExpired = c.validUntil == 0 || block.timestamp <= c.validUntil;
        bool isValid = c.exists && !c.revoked && isNotExpired;

        return (isValid, c.auditor, c.status, c.issuedAt, c.validUntil, c.revoked);
    }

    /// @notice Revokes a previously issued compliance certificate.
    /// Only the issuing auditor or contract owner can revoke it.
    function revokeComplianceCertificate(bytes32 reportHash, string calldata reason) external onlyAuditor {
        require(certificatesByReport[reportHash].exists, "Certificate does not exist for this report");
        Certificate storage cert = certificatesByReport[reportHash];
        require(!cert.revoked, "Certificate already revoked");
        require(cert.auditor == msg.sender || msg.sender == owner, "Only issuing auditor or owner can revoke");

        cert.revoked = true;
        cert.revocationReason = reason;

        certificatesById[cert.certId].revoked = true;
        certificatesById[cert.certId].revocationReason = reason;

        emit CertificateRevoked(cert.certId, reportHash, msg.sender, reason);
    }
}

