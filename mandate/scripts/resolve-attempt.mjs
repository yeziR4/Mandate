/**
 * Sign a verdict with the keeper key and relay it on-chain.
 *
 *   node mandate/scripts/resolve-attempt.mjs --attempt 4 --transcript-file <path> --severity 3
 *
 * The keeper is the only signer, and anyone may relay - that is the design: a verdict cannot be
 * withheld, only signed. This script does both steps on the operator's machine because the hosted
 * keeper's judge endpoint is currently misconfigured (gateway answers "model is required").
 *
 * The signature is EIP-712 over the arena's own domain, so the contract verifies it with
 * `ECDSA.recover` against `keeper` - no trust in this script at all.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, fallback, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of [
  path.resolve(here, "../../.env"),
  path.resolve(here, "../../.env.local"),
  path.resolve(here, "../../.env.mandate"),
]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const args = process.argv.slice(2);
const arg = (name, fallbackValue = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallbackValue;
};

const attemptId = arg("attempt");
const transcriptFile = arg("transcript-file");
const severity = Number(arg("severity", "3"));
const success = severity === 3;

if (!attemptId || !transcriptFile) {
  console.error("usage: --attempt <id> --transcript-file <path> [--severity 0..3]");
  process.exit(1);
}

const arena = process.env.ARENA_ADDRESS ?? "0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d";
const rpc = process.env.RPC_URL ?? "https://andromeda.metis.io/?owner=1088";
const keeperKey = process.env.KEEPER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
if (!keeperKey?.startsWith("0x")) {
  console.error("KEEPER_PRIVATE_KEY missing from .env.mandate");
  process.exit(1);
}

const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = fallback([http(rpc, { retryCount: 4, retryDelay: 400, timeout: 25_000 })]);
const publicClient = createPublicClient({ chain, transport });

const transcript = readFileSync(transcriptFile, "utf8");
const transcriptHash = keccak256(toHex(transcript));

const keeper = privateKeyToAccount(keeperKey);
const relayerKey = process.env.PRIVATE_KEY ?? keeperKey;
const relayer = privateKeyToAccount(relayerKey);
const wallet = createWalletClient({ account: relayer, chain, transport });

const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

const signature = await keeper.signTypedData({
  domain: { name: "MandateArena", version: "1", chainId: 1088, verifyingContract: arena },
  types: {
    Resolve: [
      { name: "attemptId", type: "uint256" },
      { name: "success", type: "bool" },
      { name: "severity", type: "uint8" },
      { name: "transcriptHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Resolve",
  message: { attemptId: BigInt(attemptId), success, severity, transcriptHash, deadline },
});

console.log(`attempt      ${attemptId}`);
console.log(`transcript   ${transcriptHash}`);
console.log(`severity     ${severity} (success ${success})`);
console.log(`keeper       ${keeper.address}`);
console.log(`relayer      ${relayer.address}`);

const gasPrice = await publicClient.getGasPrice();
const hash = await wallet.writeContract({
  address: arena,
  abi: [
    {
      type: "function",
      name: "resolve",
      stateMutability: "nonpayable",
      inputs: [
        { name: "attemptId", type: "uint256" },
        { name: "success", type: "bool" },
        { name: "severity", type: "uint8" },
        { name: "transcriptHash", type: "bytes32" },
        { name: "deadline", type: "uint256" },
        { name: "signature", type: "bytes" },
      ],
      outputs: [],
    },
  ],
  functionName: "resolve",
  args: [BigInt(attemptId), success, severity, transcriptHash, deadline, signature],
  gas: 500_000n,
  gasPrice: gasPrice * 2n,
});

console.log(`sent         ${hash}`);
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log(`mined        block ${receipt.blockNumber}, status ${receipt.status}`);
console.log(`explorer     https://andromeda-explorer.metis.io/tx/${hash}`);
