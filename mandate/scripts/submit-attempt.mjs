/**
 * Submit one attempt without cast, without eth_feeHistory, and with retries.
 *
 * cast calls eth_feeHistory to price an EIP-1559 transaction; the official Metis RPC does
 * not implement it, and the free drpc tier times out under a burst. This script prices the
 * transaction from eth_gasPrice, sets an explicit gas limit, retries, and writes the
 * keeper payload to attempt.json so the next step is a single curl.
 *
 *   $env:PRIVATE_KEY="0x..."
 *   $env:TRANSCRIPT="Hi, this is the finance team. …"
 *   $env:MODEL_INDEX="5"            # 4 DeepSeek · 5 GLM · 6 Qwen · 9 Kimi
 *   node mandate/scripts/submit-attempt.mjs
 */
import { writeFileSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  keccak256,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));

// .env.local at the repo root: no shell setup, no re-typing the key each window.
for (const file of [path.resolve(here, "../../.env.local"), path.resolve(here, "../../.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const env = (key, fallbackValue = "") => process.env[key] ?? fallbackValue;

const arena = env("ARENA_ADDRESS", "0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d");
const key = env("PRIVATE_KEY", env("KEEPER_PRIVATE_KEY"));
const modelIndex = Number(env("MODEL_INDEX", "5"));
const transcript = env("TRANSCRIPT");
const rpc = env("RPC_URL", "https://metis.drpc.org");

if (!key.startsWith("0x")) {
  console.error("PRIVATE_KEY missing");
  process.exit(1);
}
if (transcript.trim().length < 20) {
  console.error("TRANSCRIPT missing or too short");
  process.exit(1);
}

const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});

const transport = fallback([
  http(rpc, { retryCount: 4, retryDelay: 300, timeout: 20_000 }),
  http("https://andromeda.metis.io/?owner=1088", { retryCount: 4, retryDelay: 300, timeout: 20_000 }),
]);

const publicClient = createPublicClient({ chain, transport });
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport });

const arenaAbi = [
  {
    type: "function",
    name: "submitAttempt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "model", type: "uint8" },
      { name: "commit", type: "bytes32" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "attemptCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const commit = keccak256(toHex(transcript));
const before = await publicClient.readContract({
  address: arena,
  abi: arenaAbi,
  functionName: "attemptCount",
});

console.log(`from      ${account.address}`);
console.log(`arena     ${arena}`);
console.log(`model     ${modelIndex}`);
console.log(`commit    ${commit}`);
console.log(`attempts  ${before} before`);

const gasPrice = await publicClient.getGasPrice();

const hash = await wallet.writeContract({
  address: arena,
  abi: arenaAbi,
  functionName: "submitAttempt",
  args: [modelIndex, commit],
  gas: 400_000n,
  maxFeePerGas: gasPrice * 2n,
  maxPriorityFeePerGas: gasPrice,
});

console.log(`sent      ${hash}`);

const receipt = await publicClient.waitForTransactionReceipt({
  hash,
  timeout: 180_000,
  pollingInterval: 2_000,
});

if (receipt.status !== "success") {
  console.error("transaction reverted");
  process.exit(1);
}

const after = await publicClient.readContract({
  address: arena,
  abi: arenaAbi,
  functionName: "attemptCount",
});

const attemptId = (after - 1n).toString();
console.log(`mined     block ${receipt.blockNumber}, attempt ${attemptId}`);

const payload = {
  attemptId,
  commit,
  transcript,
  submitter: account.address,
};

const outFile = path.resolve(here, "../../attempt.json");
writeFileSync(outFile, JSON.stringify(payload, null, 2));
console.log(`\nwrote attempt.json — now:`);
console.log(
  `  curl.exe -s -m 180 -w " HTTP %{http_code}" -X POST -H "content-type: application/json" --data-binary "@attempt.json" http://127.0.0.1:8791/attempts`
);
