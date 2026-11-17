/**
 * Swap WMETIS -> m.USDC against the Hercules V2 pool, then fund a purse.
 *
 *   node mandate/scripts/fund-purse-direct.mjs [--wrap 2.3] [--model 1] [--dry]
 *
 * OpenOcean's router reverts on this pair ("OpenOcean external call failed"), so this talks to the
 * volatile pool directly, which is what a router does anyway:
 *
 *   1. wrap native METIS -> WMETIS if needed
 *   2. ask the pool for the exact output (getAmountOut), keep a 1% buffer
 *   3. transfer the input to the pool, then call swap(0, amountOut, recipient, 0x)
 *   4. approve the arena and fundPurse(model, amount)
 *
 * Direct pool calls skip router fees and are verifiable: every number below comes from the pool
 * itself, not from an aggregator's opinion.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, fallback, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of [path.resolve(here, "../../.env"), path.resolve(here, "../../.env.local"), path.resolve(here, "../../.env.mandate")]) {
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
const dry = args.includes("--dry");

const WRAP = arg("wrap", "2.3");
const MODEL = Number(arg("model", "1"));
const POOL = "0xef874fede49cf49940e8c472f3e58e75ea65b34c";
const WMETIS = "0x75cb093E4D61d2A2e65D8e0BBb01DE8d89b53481";
const USDC = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21";
const ARENA = process.env.ARENA_ADDRESS ?? "0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d";
const rpc = process.env.RPC_URL ?? "https://andromeda.metis.io/?owner=1088";

const key = process.env.PRIVATE_KEY ?? process.env.KEEPER_PRIVATE_KEY;
if (!key?.startsWith("0x")) {
  console.error("PRIVATE_KEY missing");
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
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport });

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
];
const POOL_ABI = [
  { type: "function", name: "getAmountOut", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "bytes" }], outputs: [] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

const gasPrice = await publicClient.getGasPrice();
const legacy = { gasPrice: gasPrice * 2n };

const sinceWrap = parseUnits(WRAP, 18);
const token0 = (await publicClient.readContract({ address: POOL, abi: POOL_ABI, functionName: "token0" })).toLowerCase();
const wmetisIsToken0 = token0 === WMETIS.toLowerCase();

const amountOut = await publicClient.readContract({
  address: POOL,
  abi: POOL_ABI,
  functionName: "getAmountOut",
  args: [sinceWrap, WMETIS],
});
const minOut = (amountOut * 99n) / 100n;

console.log(`wrap     ${WRAP} METIS -> WMETIS`);
console.log(`pool     ${POOL} (wmetis is token${wmetisIsToken0 ? 0 : 1})`);
console.log(`quote    ${formatUnits(amountOut, 6)} m.USDC, sending with ${formatUnits(minOut, 6)} minimum`);

const existing = await publicClient.readContract({ address: WMETIS, abi: ERC20, functionName: "balanceOf", args: [account.address] });
console.log(`wmetis   wallet holds ${formatUnits(existing, 18)}`);

if (dry) {
  console.log("dry run: stopping");
  process.exit(0);
}

let wmetis = existing;
if (wmetis < sinceWrap) {
  const hash = await wallet.writeContract({ address: WMETIS, abi: ERC20, functionName: "deposit", value: sinceWrap, gas: 120_000n, ...legacy });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  wmetis = await publicClient.readContract({ address: WMETIS, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  console.log(`wrapped  ${formatUnits(wmetis, 18)} WMETIS (${hash})`);
}

const amountIn = wmetis < sinceWrap ? wmetis : sinceWrap;

const transferHash = await wallet.writeContract({
  address: WMETIS,
  abi: ERC20,
  functionName: "transfer",
  args: [POOL, amountIn],
  gas: 90_000n,
  ...legacy,
});
await publicClient.waitForTransactionReceipt({ hash: transferHash, timeout: 120_000 });
console.log(`sent     ${formatUnits(amountIn, 18)} WMETIS to the pool (${transferHash})`);

const freshOut = await publicClient.readContract({
  address: POOL,
  abi: POOL_ABI,
  functionName: "getAmountOut",
  args: [amountIn, WMETIS],
});
const floor = (freshOut * 99n) / 100n;

const swapHash = await wallet.writeContract({
  address: POOL,
  abi: POOL_ABI,
  functionName: "swap",
  args: [wmetisIsToken0 ? 0n : floor, wmetisIsToken0 ? floor : 0n, account.address, "0x"],
  gas: 300_000n,
  ...legacy,
});
const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, timeout: 120_000 });
console.log(`swapped  ${swapHash} status ${swapReceipt.status}`);
if (swapReceipt.status !== "success") process.exit(1);

const balance = await publicClient.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [account.address] });
console.log(`wallet   ${formatUnits(balance, 6)} m.USDC`);
if (balance === 0n) process.exit(1);

const approveHash = await wallet.writeContract({ address: USDC, abi: ERC20, functionName: "approve", args: [ARENA, balance], gas: 80_000n, ...legacy });
await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });

const fundHash = await wallet.writeContract({
  address: ARENA,
  abi: [
    { type: "function", name: "fundPurse", stateMutability: "nonpayable", inputs: [{ name: "model", type: "uint8" }, { name: "amount", type: "uint96" }], outputs: [] },
  ],
  functionName: "fundPurse",
  args: [MODEL, balance],
  gas: 300_000n,
  ...legacy,
});
const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash, timeout: 120_000 });
console.log(`funded   model ${MODEL} with ${formatUnits(balance, 6)} m.USDC (${fundHash}) status ${fundReceipt.status}`);
console.log(`explorer https://andromeda-explorer.metis.io/tx/${fundHash}`);
