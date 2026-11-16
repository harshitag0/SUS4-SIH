// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AgreementRegistry
 * @notice Tamper-evidence registry for AgriLink procurement agreements (India -> Singapore).
 *
 * Only integrity metadata goes on-chain:
 *   - agreementRef : keccak256 of the off-chain agreement ID (e.g. "AGL-2026-000123") — no names, prices or PII
 *   - docHash      : SHA-256 of the final signed PDF (stored off-chain, write-once)
 *   - version      : 1 for the original, 2.. for each amendment
 *   - prevDocHash  : hash of the previous signed version (links amendments into a chain)
 *
 * Records are append-only: a version can never be overwritten, a document hash can be registered only once,
 * and an amendment must be the next version number.
 */
contract AgreementRegistry is AccessControl, Pausable {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Record {
        bytes32 docHash;
        bytes32 prevDocHash;
        uint32 version;
        uint64 registeredAt;
        address registrar;
    }

    struct Lookup {
        bytes32 agreementRef;
        uint32 version;
    }

    mapping(bytes32 => Record[]) private _versions;   // agreementRef => versions (index 0 = version 1)
    mapping(bytes32 => Lookup) private _byHash;        // docHash => where it was registered

    event AgreementRegistered(
        bytes32 indexed agreementRef,
        uint32 indexed version,
        bytes32 docHash,
        bytes32 prevDocHash,
        address registrar,
        uint64 registeredAt
    );

    error ZeroHash();
    error WrongVersion(uint32 expected, uint32 given);
    error HashAlreadyRegistered(bytes32 docHash);
    error UnknownAgreement(bytes32 agreementRef);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, admin);
    }

    /// @notice Register the hash of a fully signed agreement version. Append-only.
    function register(bytes32 agreementRef, bytes32 docHash, uint32 version)
        external
        onlyRole(REGISTRAR_ROLE)
        whenNotPaused
        returns (uint32)
    {
        if (agreementRef == bytes32(0) || docHash == bytes32(0)) revert ZeroHash();
        Record[] storage list = _versions[agreementRef];
        uint32 expected = uint32(list.length) + 1;
        if (version != expected) revert WrongVersion(expected, version);
        if (_byHash[docHash].version != 0) revert HashAlreadyRegistered(docHash);

        bytes32 prev = list.length == 0 ? bytes32(0) : list[list.length - 1].docHash;
        uint64 nowTs = uint64(block.timestamp);
        list.push(Record(docHash, prev, version, nowTs, msg.sender));
        _byHash[docHash] = Lookup(agreementRef, version);

        emit AgreementRegistered(agreementRef, version, docHash, prev, msg.sender, nowTs);
        return version;
    }

    function versionCount(bytes32 agreementRef) external view returns (uint256) {
        return _versions[agreementRef].length;
    }

    function getVersion(bytes32 agreementRef, uint32 version) external view returns (Record memory) {
        Record[] storage list = _versions[agreementRef];
        if (version == 0 || version > list.length) revert UnknownAgreement(agreementRef);
        return list[version - 1];
    }

    function latest(bytes32 agreementRef) external view returns (Record memory) {
        Record[] storage list = _versions[agreementRef];
        if (list.length == 0) revert UnknownAgreement(agreementRef);
        return list[list.length - 1];
    }

    /// @notice Find which agreement/version a document hash belongs to (version 0 = not registered).
    function lookup(bytes32 docHash) external view returns (bytes32 agreementRef, uint32 version) {
        Lookup memory l = _byHash[docHash];
        return (l.agreementRef, l.version);
    }

    /// @notice True if docHash is the latest registered version of agreementRef.
    function isLatest(bytes32 agreementRef, bytes32 docHash) external view returns (bool) {
        Record[] storage list = _versions[agreementRef];
        return list.length != 0 && list[list.length - 1].docHash == docHash;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
