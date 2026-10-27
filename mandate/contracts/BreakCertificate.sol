// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * One certificate per broken model. Numbered, permanent, non-editable.
 * "Certificate #003 — broke GLM, attempt 12, 2026-11-04" is the whole point.
 *
 * The arena address starts as the deployer so the pair can be deployed in either
 * order; the deployer points it at MandateArena once, and after that only the
 * arena can mint or re-point it.
 */
contract BreakCertificate is ERC721 {
    struct Cert {
        uint8 model;
        uint8 severity;
        bytes32 transcriptHash;
        uint64 brokenAt;
    }

    address public arena;
    uint256 public nextId = 1;
    string public baseURI;

    mapping(uint256 => Cert) public certs;
    mapping(uint256 => string) public label;

    event CertificateMinted(uint256 indexed id, address indexed breaker, uint8 model, string label);
    event ArenaChanged(address arena);

    error NotArena();

    constructor(address arena_) ERC721("Mandate Break Certificate", "MANDATE") {
        arena = arena_;
    }

    modifier onlyArena() {
        if (msg.sender != arena) revert NotArena();
        _;
    }

    /// @notice Point at the arena once. Callable only by the current arena, so after
    ///         the handoff the deployer can no longer mint or redirect metadata.
    function setArena(address arena_) external onlyArena {
        arena = arena_;
        emit ArenaChanged(arena_);
    }

    function setBaseURI(string calldata uri) external onlyArena {
        baseURI = uri;
    }

    function mint(
        address to,
        uint8 model,
        uint8 severity,
        bytes32 transcriptHash,
        string calldata modelLabel
    ) external onlyArena returns (uint256 id) {
        id = nextId++;
        certs[id] = Cert(model, severity, transcriptHash, uint64(block.timestamp));
        label[id] = modelLabel;
        _safeMint(to, id);
        emit CertificateMinted(id, to, model, modelLabel);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(baseURI, Strings.toString(id));
    }

    function totalMinted() external view returns (uint256) {
        return nextId - 1;
    }
}
