/**
 * Lower the attempt cooldown.
 *
 *   node mandate/scripts/set-cooldown.mjs 60
 *
 * Users must produce three transactions from their own wallet to count under Metis Rise. At the
 * deployed 600s cooldown that takes twenty minutes per person; at 60s it takes three. Owner-only.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of [path.resolve(here, "../../.env"), path.resolve(here, "../../.env.local"), path.resolve(here, "../../.env.mandate")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const seconds = Number(process.argv[2] ?? "60");
const ARENA = process.env.ARENA_ADDRESS ?? "0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d";
const rpc = process.env.RPC_URL ?? "https://andromeda.metis.io/?owner=1088";

const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [rpc] } },
});
const transport = fallback([http(rpc, { retryCount: 4, retryDelay: 400, timeout: 25_000 })]);
const publicClient = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), chain, transport });

const ABI = [
  { type: "function", name: "setCooldown", stateMutability: "nonpayable", inputs: [{ type: "uint64" }], outputs: [] },
  { type: "function", name: "cooldown", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
];

const before = await publicClient.readContract({ address: ARENA, abi: ABI, functionName: "cooldown" });
console.log(`cooldown before: ${before}s -> setting ${seconds}s`);

const gasPrice = await publicClient.getGasPrice();
const hash = await wallet.writeContract({
  address: ARENA,
  abi: ABI,
  functionName: "setCooldown",
  args: [BigInt(seconds)],
  gas: 120_000n,
  gasPrice: gasPrice * 2n,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
console.log(`tx ${hash} status ${receipt.status}`);

const after = await publicClient.readContract({ address: ARENA, abi: ABI, functionName: "cooldown" });
console.log(`cooldown after:  ${after}s`);
console.log(`explorer https://andromeda-explorer.metis.io/tx/${hash}`);
