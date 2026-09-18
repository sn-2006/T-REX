// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ChainTDSRegistry
/// @notice Anchors the SHA-256 fingerprint of a ChainTDS reconciliation
/// report on-chain, and lets anyone check later whether a given hash was
/// ever anchored and when. The contract never stores the report's actual
/// contents — only its hash — so no financial data touches the chain.
contract ChainTDSRegistry {
    struct Anchor {
        address submitter;
        uint256 timestamp;
        bool exists;
    }

    mapping(bytes32 => Anchor) private anchors;

    event ReportAnchored(bytes32 indexed reportHash, address indexed submitter, uint256 timestamp);

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
}
