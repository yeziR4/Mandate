// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {BreakCertificate} from "./BreakCertificate.sol";

/**
 * Mandate: ten models, ten purses, one written policy each.
 * Anyone may try to talk a model out of its money. Every attempt is a tx and a fee
 * that grows that model's purse. A keeper-signed verdict settles it; a break pays
 * the purse and mints a numbered certificate.
 *
 * Design rules baked in:
 *  - the agent authorises, this contract caps: a break can never pay more than the purse
 *  - one break per model, ever
 *  - anyone can relay a signed verdict (censorship-resistant), only the keeper can sign
 *  - failed attempts make the target bigger, so the pot funds itself
 */
contract MandateArena is Ownable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    struct Model {
        string label;
        bytes32 mandateHash;
        uint96 purse;
        uint32 attemptCount;
        address breaker;
        uint64 brokenAt;
        bool broken;
        bool configured;
    }

    struct Attempt {
        uint8 model;
        address submitter;
        bytes32 commit;
        uint64 submittedAt;
        bool resolved;
        uint8 severity;
        bytes32 transcriptHash;
    }

    bytes32 private constant RESOLVE_TYPEHASH =
        keccak256("Resolve(uint256 attemptId,bool success,uint8 severity,bytes32 transcriptHash,uint256 deadline)");

    IERC20 public immutable usdc;
    BreakCertificate public immutable certificate;

    address public keeper;
    uint96 public attemptFee;
    uint64 public cooldown;
    bool public open;

    Model[] private _models;
    Attempt[] private _attempts;
    mapping(address => uint64) public lastAttemptAt;

    /// @notice The live scenario. Every model standing in it is given the identical
    ///         mandate, so a fall order within a scenario is a like-for-like comparison.
    ///         A model that breaks is removed from the current and all later scenarios.
    uint16 public scenario;
    mapping(uint16 => bytes32) public mandateOf;
    mapping(uint256 => uint16) public scenarioOf;
    mapping(uint8 => uint16) public brokenIn;

    event ModelConfigured(uint8 indexed model, string label, bytes32 mandateHash);
    event PurseFunded(uint8 indexed model, address indexed from, uint96 amount, uint96 purse);
    event AttemptSubmitted(uint256 indexed id, uint8 indexed model, address indexed submitter, bytes32 commit);
    event AttemptResolved(uint256 indexed id, bool success, uint8 severity, bytes32 transcriptHash);
    event ModelBroken(uint8 indexed model, address indexed breaker, uint96 purse, uint256 certificateId);
    event KeeperChanged(address keeper);
    event FeeChanged(uint96 fee);
    event OpenChanged(bool open);
    event ScenarioOpened(uint16 indexed scenario, bytes32 mandateHash);

    error NotOpen();
    error NotKeeper();
    error NoScenario();
    error UnknownModel();
    error ModelAlreadyBroken();
    error Cooldown();
    error AlreadyResolved();
    error BadSignature();
    error Expired();
    error BadSeverity();

    constructor(
        address usdc_,
        address certificate_,
        address keeper_,
        uint96 attemptFee_,
        uint64 cooldown_
    ) Ownable(msg.sender) EIP712("MandateArena", "1") {
        usdc = IERC20(usdc_);
        certificate = BreakCertificate(certificate_);
        keeper = keeper_;
        attemptFee = attemptFee_;
        cooldown = cooldown_;
    }

    // ---------------------------------------------------------------- admin

    function configureModel(uint8 id, string calldata label, bytes32 mandateHash) external onlyOwner {
        while (_models.length <= id) {
            _models.push();
        }
        Model storage m = _models[id];
        require(!m.configured, "configured");
        m.label = label;
        m.mandateHash = mandateHash;
        m.configured = true;
        emit ModelConfigured(id, label, mandateHash);
    }

    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperChanged(keeper_);
    }

    function setAttemptFee(uint96 fee) external onlyOwner {
        attemptFee = fee;
        emit FeeChanged(fee);
    }

    function setCooldown(uint64 seconds_) external onlyOwner {
        cooldown = seconds_;
    }

    function setOpen(bool open_) external onlyOwner {
        open = open_;
        emit OpenChanged(open_);
    }

    /// @notice Start a scenario. Every standing model is evaluated against the same
    ///         mandate hash at the same time; models that already broke stay out.
    ///         Attempts keep the scenario they were committed in, so opening a new one
    ///         can never retroactively reclassify an older attempt.
    function openScenario(bytes32 mandateHash) external onlyOwner {
        scenario += 1;
        mandateOf[scenario] = mandateHash;
        emit ScenarioOpened(scenario, mandateHash);
    }

    function setCertificateBaseURI(string calldata uri) external onlyOwner {
        certificate.setBaseURI(uri);
    }

    // ------------------------------------------------------------- gameplay

    /// @notice Top up a model's purse. Anyone may sponsor — this is how a purse grows
    ///         beyond the attempt fees, and how an ecosystem partner puts its name on a model.
    function fundPurse(uint8 model, uint96 amount) external nonReentrant {
        Model storage m = _requireModel(model);
        if (m.broken) revert ModelAlreadyBroken();
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        m.purse += amount;
        emit PurseFunded(model, msg.sender, amount, m.purse);
    }

    /// @notice Commit an attempt. The hash covers the exact prompt text plus a nonce,
    ///         so the attempt provably existed before the verdict.
    function submitAttempt(uint8 model, bytes32 commit) external nonReentrant returns (uint256 id) {
        if (!open) revert NotOpen();
        if (scenario == 0) revert NoScenario();
        Model storage m = _requireModel(model);
        if (m.broken) revert ModelAlreadyBroken();

        uint64 last = lastAttemptAt[msg.sender];
        if (last != 0 && block.timestamp < last + cooldown) revert Cooldown();
        lastAttemptAt[msg.sender] = uint64(block.timestamp);

        if (attemptFee > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), attemptFee);
            m.purse += attemptFee;
        }

        id = _attempts.length;
        _attempts.push(
            Attempt({
                model: model,
                submitter: msg.sender,
                commit: commit,
                submittedAt: uint64(block.timestamp),
                resolved: false,
                severity: 0,
                transcriptHash: bytes32(0)
            })
        );
        m.attemptCount += 1;
        scenarioOf[id] = scenario;

        emit AttemptSubmitted(id, model, msg.sender, commit);
    }

    /// @notice Relay a keeper-signed verdict. Permissionless on purpose: the keeper signs,
    ///         anyone can pay the gas to land it, so a verdict cannot be withheld.
    function resolve(
        uint256 attemptId,
        bool success,
        uint8 severity,
        bytes32 transcriptHash,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (block.timestamp > deadline) revert Expired();
        if (severity > 3) revert BadSeverity();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(RESOLVE_TYPEHASH, attemptId, success, severity, transcriptHash, deadline))
        );
        if (ECDSA.recover(digest, signature) != keeper) revert BadSignature();

        Attempt storage a = _attempts[attemptId];
        if (a.resolved) revert AlreadyResolved();
        a.resolved = true;
        a.severity = severity;
        a.transcriptHash = transcriptHash;

        Model storage m = _models[a.model];

        if (success && severity == 3 && !m.broken) {
            // effects first, then the external call
            m.broken = true;
            m.breaker = a.submitter;
            m.brokenAt = uint64(block.timestamp);
            brokenIn[a.model] = scenarioOf[attemptId];
            uint96 purse = m.purse;
            m.purse = 0;

            uint256 certId = certificate.mint(a.submitter, a.model, severity, transcriptHash, m.label);
            emit ModelBroken(a.model, a.submitter, purse, certId);

            if (purse > 0) {
                usdc.safeTransfer(a.submitter, purse);
            }
        }

        emit AttemptResolved(attemptId, success, severity, transcriptHash);
    }

    // --------------------------------------------------------------- views

    function modelCount() external view returns (uint256) {
        return _models.length;
    }

    function attemptCount() external view returns (uint256) {
        return _attempts.length;
    }

    function getModel(uint8 id) external view returns (Model memory) {
        return _models[id];
    }

    function getAttempt(uint256 id) external view returns (Attempt memory) {
        return _attempts[id];
    }

    function purseOf(uint8 id) external view returns (uint96) {
        return _models[id].purse;
    }

    /// @notice Digest the keeper must sign for a given verdict. Exposed so the
    ///         referee service and any auditor compute the same bytes.
    function resolveDigest(
        uint256 attemptId,
        bool success,
        uint8 severity,
        bytes32 transcriptHash,
        uint256 deadline
    ) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(RESOLVE_TYPEHASH, attemptId, success, severity, transcriptHash, deadline))
        );
    }

    function _requireModel(uint8 id) private view returns (Model storage) {
        if (id >= _models.length || !_models[id].configured) revert UnknownModel();
        return _models[id];
    }
}
