/**
 * Read-only chain state for the Metis Rise report.
 *
 *   node mandate/scripts/state.mjs
 *
 * Answers the three questions the program actually counts: is the scenario open, how much sits in
 * the purses, and how many distinct addresses have ever submitted an attempt.
 */

import { createPublicClient, http, parseAbi, formatUnits } from "viem";

const RPC = process.env.RPC_URL ?? "https://andromeda.metis.io/?owner=1088";
const ARENA = "0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d";
const CERT = "0x0441b60c91bdd62f752a3bd8186ba8c0f7cd03cb";
const USDC = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21";

const ABI = parseAbi([
  "function modelCount() view returns (uint256)",
  "function attemptCount() view returns (uint256)",
  "function purseOf(uint8) view returns (uint96)",
  "function open() view returns (bool)",
  "function scenario() view returns (uint16)",
  "function bounty() view returns (uint96)",
  "function attemptFee() view returns (uint96)",
  "function cooldown() view returns (uint64)",
  "function balanceOf(address) view returns (uint256)",
  "event AttemptSubmitted(uint256 indexed id, uint8 indexed model, address indexed submitter, bytes32 commit)",
  "event ModelBroken(uint8 indexed model, address indexed breaker, uint96 purse, uint256 certificateId)",
  "event PurseFunded(uint8 indexed model, address indexed from, uint96 amount, uint96 purse)",
]);

const client = createPublicClient({ transport: http(RPC) });

const [modelCount, attemptCount, open, scenario, bounty, attemptFee, cooldown, arenaBalance] =
  await Promise.all([
    client.readContract({ address: ARENA, abi: ABI, functionName: "modelCount" }),
    client.readContract({ address: ARENA, abi: ABI, functionName: "attemptCount" }),
    client.readContract({ address: ARENA, abi: ABI, functionName: "open" }),
    client.readContract({ address: ARENA, abi: ABI, functionName: "scenario" }),
    client.readContract({ address: ARENA, abi: ABI, functionName: "bounty" }),
    client.readContract({ address: ARENA, abi: ABI, functionName: "attemptFee" }),
    client.readContract({ address: ARENA, abi: ABI, functionName: "cooldown" }),
    client.readContract({ address: USDC, abi: ABI, functionName: "balanceOf", args: [ARENA] }),
  ]);

console.log(`scenario ${scenario} · open ${open} · attempt fee ${formatUnits(attemptFee, 6)} · cooldown ${cooldown}s`);
console.log(`bounty ${formatUnits(bounty, 6)} mUSDC · arena holds ${formatUnits(arenaBalance, 6)} mUSDC`);
console.log(`models ${modelCount} · attempts submitted ${attemptCount}\n`);

const purses = [];
for (let id = 0; id < Number(modelCount); id += 1) {
  const purse = await client.readContract({ address: ARENA, abi: ABI, functionName: "purseOf", args: [id] });
  purses.push({ id, purse: formatUnits(purse, 6) });
}
console.log("purse per model (mUSDC):", purses.map((p) => `${p.id}:${p.purse}`).join("  "));

// Attempts from the deploy date onward, chunked.
const latest = await client.getBlockNumber();
const from = latest - 1_200_000n;
const CHUNK = 100_000n;
const submitted = [];
const broken = [];

for (let start = from; start <= latest; start += CHUNK) {
  const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
  for (const eventName of ["AttemptSubmitted", "ModelBroken"]) {
    try {
      const logs = await client.getLogs({ address: ARENA, event: ABI.find((x) => x.name === eventName), fromBlock: start, toBlock: end });
      (eventName === "AttemptSubmitted" ? submitted : broken).push(...logs);
    } catch (cause) {
      console.log(`  (log scan ${eventName} ${start}-${end} failed: ${String(cause).slice(0, 80)})`);
    }
  }
}

const submitters = new Map();
for (const log of submitted) {
  const who = log.args.submitter.toLowerCase();
  submitters.set(who, (submitters.get(who) ?? 0) + 1);
}

console.log(`\nAttemptSubmitted events: ${submitted.length} · distinct addresses: ${submitters.size}`);
for (const [who, count] of submitters) console.log(`  ${who}  ${count}`);
console.log(`ModelBroken events: ${broken.length}`);
for (const log of broken) {
  console.log(`  model ${log.args.model} → ${log.args.breaker}  purse ${formatUnits(log.args.purse, 6)}  cert #${log.args.certificateId}`);
}
