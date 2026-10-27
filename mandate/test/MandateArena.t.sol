// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MandateArena} from "../contracts/MandateArena.sol";
import {BreakCertificate} from "../contracts/BreakCertificate.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin", "m.USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MandateArenaTest is Test {
    MandateArena internal arena;
    BreakCertificate internal cert;
    MockUSDC internal usdc;

    uint256 internal constant KEEPER_PK = 0xA11CE;
    uint256 internal constant WRONG_PK = 0xB0B;

    address internal keeper;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal relayer = makeAddr("relayer");

    uint96 internal constant FEE = 100_000; // $0.10
    uint96 internal constant OPENING_PURSE = 5_000_000; // $5.00
    uint64 internal constant COOLDOWN = 600;

    uint8 internal constant MODELS = 10;

    function setUp() public {
        keeper = vm.addr(KEEPER_PK);

        usdc = new MockUSDC();
        cert = new BreakCertificate(address(this));
        arena = new MandateArena(address(usdc), address(cert), keeper, FEE, COOLDOWN);

        // hand minting rights to the arena; the deployer loses them permanently
        cert.setArena(address(arena));

        for (uint8 i = 0; i < MODELS; i++) {
            arena.configureModel(i, string.concat("M", vm.toString(i)), keccak256(abi.encode("mandate", i)));
        }

        // seed every purse at $5 and open the arena
        usdc.mint(address(this), uint256(OPENING_PURSE) * MODELS);
        usdc.approve(address(arena), type(uint256).max);
        for (uint8 i = 0; i < MODELS; i++) {
            arena.fundPurse(i, OPENING_PURSE);
        }
        arena.openScenario(keccak256("scenario one"));
        arena.setOpen(true);

        usdc.mint(alice, 1_000_000_000);
        usdc.mint(bob, 1_000_000_000);
        vm.prank(alice);
        usdc.approve(address(arena), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(arena), type(uint256).max);
    }

    // ------------------------------------------------------------- helpers

    function _sig(
        uint256 attemptId,
        bool success,
        uint8 severity,
        bytes32 transcriptHash
    ) internal view returns (bytes memory sig, uint256 deadline) {
        deadline = block.timestamp + 1 hours;
        return (_sigFor(KEEPER_PK, attemptId, success, severity, transcriptHash, deadline), deadline);
    }

    function _sigFor(
        uint256 pk,
        uint256 attemptId,
        bool success,
        uint8 severity,
        bytes32 transcriptHash,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 digest = arena.resolveDigest(attemptId, success, severity, transcriptHash, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _submit(address who, uint8 model) internal returns (uint256 id) {
        vm.prank(who);
        id = arena.submitAttempt(model, keccak256(abi.encode("attempt", who, model, block.timestamp)));
    }

    // ------------------------------------------------------------- registry

    function test_registry_hasTenConfiguredModels() public view {
        assertEq(arena.modelCount(), MODELS);
        for (uint8 i = 0; i < MODELS; i++) {
            assertTrue(arena.getModel(i).configured);
            assertEq(arena.purseOf(i), OPENING_PURSE);
        }
    }

    function test_registry_onlyOwnerConfigures() public {
        vm.prank(alice);
        vm.expectRevert();
        arena.configureModel(0, "dup", bytes32(0));
    }

    // ------------------------------------------------------- attempt pricing

    function test_submit_chargesFeeIntoPurse() public {
        uint256 id = _submit(alice, 0);

        assertEq(id, 0);
        assertEq(arena.purseOf(0), OPENING_PURSE + FEE);
        assertEq(usdc.balanceOf(address(arena)), uint256(OPENING_PURSE) * MODELS + FEE);
        assertEq(arena.attemptCount(), 1);

        MandateArena.Attempt memory a = arena.getAttempt(0);
        assertEq(a.submitter, alice);
        assertEq(a.model, 0);
        assertFalse(a.resolved);
    }

    function test_submit_enforcesCooldown() public {
        _submit(alice, 0);

        vm.prank(alice);
        vm.expectRevert(MandateArena.Cooldown.selector);
        arena.submitAttempt(0, keccak256("again"));

        vm.warp(block.timestamp + COOLDOWN);
        uint256 id = _submit(alice, 0);
        assertEq(id, 1);
    }

    function test_submit_cooldownIsPerAddress() public {
        _submit(alice, 0);
        uint256 id = _submit(bob, 0);
        assertEq(id, 1);
    }

    function test_submit_rejectsUnknownModel() public {
        vm.prank(alice);
        vm.expectRevert(MandateArena.UnknownModel.selector);
        arena.submitAttempt(99, keccak256("x"));
    }

    function test_submit_rejectsWhenClosed() public {
        arena.setOpen(false);
        vm.prank(alice);
        vm.expectRevert(MandateArena.NotOpen.selector);
        arena.submitAttempt(0, keccak256("x"));
    }

    function testFuzz_feeAccumulates(uint8 attempts) public {
        attempts = uint8(bound(attempts, 1, 20));
        for (uint8 i = 0; i < attempts; i++) {
            _submit(bob, 1);
            vm.warp(block.timestamp + COOLDOWN);
        }
        assertEq(arena.purseOf(1), OPENING_PURSE + uint96(attempts) * FEE);
        assertEq(arena.getModel(1).attemptCount, attempts);
    }

    // -------------------------------------------------------------- breaking

    function test_break_paysPurseAndMintsCertificate() public {
        uint256 id = _submit(alice, 0);
        uint256 purse = arena.purseOf(0);

        bytes32 transcript = keccak256("the transcript");
        (bytes memory sig, uint256 deadline) = _sig(id, true, 3, transcript);

        uint256 before = usdc.balanceOf(alice);
        // a third party relays the keeper's verdict
        vm.prank(relayer);
        arena.resolve(id, true, 3, transcript, deadline, sig);

        assertEq(usdc.balanceOf(alice), before + purse);
        assertEq(arena.purseOf(0), 0);
        assertTrue(arena.getModel(0).broken);
        assertEq(arena.getModel(0).breaker, alice);
        assertEq(cert.totalMinted(), 1);
        assertEq(cert.ownerOf(1), alice);
        assertEq(arena.getAttempt(id).severity, 3);
        assertEq(arena.getAttempt(id).transcriptHash, transcript);
    }

    function test_break_certificateCarriesMetadata() public {
        uint256 id = _submit(alice, 3);
        bytes32 transcript = keccak256("evidence");
        (bytes memory sig, uint256 deadline) = _sig(id, true, 3, transcript);
        arena.resolve(id, true, 3, transcript, deadline, sig);

        (uint8 model, , , , ) = cert.certs(1);
        (, uint8 severity, , , ) = cert.certs(1);
        (, , bytes32 stored, , ) = cert.certs(1);
        (, , , uint64 atTs, ) = cert.certs(1);
        (, , , , uint256 certAttempt) = cert.certs(1);

        assertEq(model, 3);
        assertEq(severity, 3);
        assertEq(stored, transcript);
        assertEq(atTs, block.timestamp);
        assertEq(certAttempt, id);
        assertEq(cert.label(1), "M3");
    }

    function test_break_modelRetires() public {
        uint256 id = _submit(alice, 0);
        (bytes memory sig, uint256 deadline) = _sig(id, true, 3, keccak256("t"));
        arena.resolve(id, true, 3, keccak256("t"), deadline, sig);

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(bob);
        vm.expectRevert(MandateArena.ModelAlreadyBroken.selector);
        arena.submitAttempt(0, keccak256("late"));
    }

    function test_break_canOnlyHappenOncePerModel() public {
        // two attempts exist before the break, so a late verdict on the second
        // still has to be a no-op
        uint256 first = _submit(alice, 0);
        vm.warp(block.timestamp + COOLDOWN);
        uint256 second = _submit(bob, 0);

        (bytes memory sig1, uint256 dl1) = _sig(first, true, 3, keccak256("t1"));
        arena.resolve(first, true, 3, keccak256("t1"), dl1, sig1);

        (bytes memory sig2, uint256 dl2) = _sig(second, true, 3, keccak256("t2"));
        uint256 bobBefore = usdc.balanceOf(bob);
        arena.resolve(second, true, 3, keccak256("t2"), dl2, sig2);

        assertEq(usdc.balanceOf(bob), bobBefore);
        assertEq(cert.totalMinted(), 1);
    }

    function test_break_secondBreakGetsItsOwncertificate() public {
        uint256 a = _submit(alice, 0);
        (bytes memory s1, uint256 d1) = _sig(a, true, 3, keccak256("t1"));
        arena.resolve(a, true, 3, keccak256("t1"), d1, s1);

        uint256 b = _submit(bob, 5);
        (bytes memory s2, uint256 d2) = _sig(b, true, 3, keccak256("t2"));
        arena.resolve(b, true, 3, keccak256("t2"), d2, s2);

        assertEq(cert.totalMinted(), 2);
        assertEq(cert.ownerOf(1), alice);
        assertEq(cert.ownerOf(2), bob);
    }

    function test_nearMiss_paysNothingAndMintsNothing() public {
        uint256 id = _submit(alice, 0);
        (bytes memory sig, uint256 deadline) = _sig(id, false, 2, keccak256("t"));

        uint256 before = usdc.balanceOf(alice);
        arena.resolve(id, false, 2, keccak256("t"), deadline, sig);

        assertEq(usdc.balanceOf(alice), before);
        assertEq(cert.totalMinted(), 0);
        assertEq(arena.getAttempt(id).severity, 2);
        assertEq(arena.purseOf(0), OPENING_PURSE + FEE);
    }

    // ------------------------------------------------------------- security

    function test_resolve_rejectsForgedSignature() public {
        uint256 id = _submit(alice, 0);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sigFor(WRONG_PK, id, true, 3, keccak256("t"), deadline);

        vm.expectRevert();
        arena.resolve(id, true, 3, keccak256("t"), deadline, sig);
        assertEq(cert.totalMinted(), 0);
    }

    function test_resolve_rejectsReplayOnDifferentAttempt() public {
        uint256 first = _submit(alice, 0);
        vm.warp(block.timestamp + COOLDOWN);
        uint256 second = _submit(bob, 1);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sigFor(KEEPER_PK, first, true, 3, keccak256("t"), deadline);

        // the signature commits to attemptId = first, so it cannot settle `second`
        vm.expectRevert();
        arena.resolve(second, true, 3, keccak256("t"), deadline, sig);
    }

    function test_resolve_rejectsExpiredVerdict() public {
        uint256 id = _submit(alice, 0);
        uint256 deadline = block.timestamp - 1;
        bytes memory sig = _sigFor(KEEPER_PK, id, true, 3, keccak256("t"), deadline);

        vm.expectRevert(MandateArena.Expired.selector);
        arena.resolve(id, true, 3, keccak256("t"), deadline, sig);
    }

    function test_resolve_rejectsDoubleResolve() public {
        uint256 id = _submit(alice, 0);
        (bytes memory sig, uint256 deadline) = _sig(id, false, 1, keccak256("t"));
        arena.resolve(id, false, 1, keccak256("t"), deadline, sig);

        vm.expectRevert(MandateArena.AlreadyResolved.selector);
        arena.resolve(id, false, 1, keccak256("t"), deadline, sig);
    }

    function test_resolve_rejectsSeverityAboveThree() public {
        uint256 id = _submit(alice, 0);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sigFor(KEEPER_PK, id, true, 4, keccak256("t"), deadline);

        vm.expectRevert(MandateArena.BadSeverity.selector);
        arena.resolve(id, true, 4, keccak256("t"), deadline, sig);
    }

    function test_certificate_onlyArenaCanMint() public {
        vm.prank(alice);
        vm.expectRevert(BreakCertificate.NotArena.selector);
        cert.mint(alice, 0, 3, keccak256("t"), "X", 0);
    }

    function test_certificate_deployerLosesMintingAfterHandoff() public {
        vm.expectRevert(BreakCertificate.NotArena.selector);
        cert.setBaseURI("https://example.com/");
    }

    // --------------------------------------------------------------- funding

    function test_fundPurse_anyoneCanSponsor() public {
        vm.prank(bob);
        arena.fundPurse(4, 1_000_000);

        assertEq(arena.purseOf(4), OPENING_PURSE + 1_000_000);
    }

    function test_fundPurse_rejectsBrokenModel() public {
        uint256 id = _submit(alice, 0);
        (bytes memory sig, uint256 deadline) = _sig(id, true, 3, keccak256("t"));
        arena.resolve(id, true, 3, keccak256("t"), deadline, sig);

        vm.prank(bob);
        vm.expectRevert(MandateArena.ModelAlreadyBroken.selector);
        arena.fundPurse(0, 1_000_000);
    }

    function test_noFundsOnlyOnePurse() public {
        // breaking one model must not touch another purse
        uint256 id = _submit(alice, 2);
        (bytes memory sig, uint256 deadline) = _sig(id, true, 3, keccak256("t"));
        arena.resolve(id, true, 3, keccak256("t"), deadline, sig);

        assertEq(arena.purseOf(2), 0);
        for (uint8 i = 0; i < MODELS; i++) {
            if (i == 2) continue;
            assertEq(arena.purseOf(i), OPENING_PURSE);
        }
    }

    // ------------------------------------------------------------- scenarios

    function test_scenario_opensWithMandate() public view {
        assertEq(arena.scenario(), 1);
        assertEq(arena.mandateOf(1), keccak256("scenario one"));
    }

    function test_scenario_onlyOwnerOpens() public {
        vm.prank(alice);
        vm.expectRevert();
        arena.openScenario(keccak256("rogue"));
    }

    function test_scenario_attemptBindsToScenarioAtCommit() public {
        uint256 id = _submit(alice, 0);
        assertEq(arena.scenarioOf(id), 1);

        arena.openScenario(keccak256("scenario two"));
        assertEq(arena.scenario(), 2);

        // an attempt made in scenario 1 keeps its scenario forever
        assertEq(arena.scenarioOf(id), 1);
    }

    function test_scenario_breakRecordsTheScenarioItFellIn() public {
        uint256 id = _submit(alice, 0);
        (bytes memory sig, uint256 deadline) = _sig(id, true, 3, keccak256("t"));

        // the scenario rotates before the verdict lands; the attempt still counts for sc.1
        arena.openScenario(keccak256("scenario two"));
        arena.resolve(id, true, 3, keccak256("t"), deadline, sig);

        assertEq(arena.brokenIn(0), 1);
        assertEq(arena.scenario(), 2);
    }

    function test_scenario_cannotSubmitBeforeFirstScenario() public {
        MandateArena fresh = new MandateArena(
            address(usdc),
            address(cert),
            keeper,
            FEE,
            COOLDOWN
        );
        fresh.configureModel(0, "Solo", keccak256("m"));
        fresh.setOpen(true);

        vm.prank(alice);
        usdc.approve(address(fresh), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(MandateArena.NoScenario.selector);
        fresh.submitAttempt(0, keccak256("x"));
    }
}
