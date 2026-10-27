/**
 * Read-only preflight for a Metis deployment. Run this before `deploy.mjs`, and again
 * after, and once more before submitting the application. It never writes anything.
 *
 *   $env:USDC_ADDRESS="0x..."
 *   node mandate/scripts/preflight.mjs
 *
 * Optional: ARENA_ADDRESS, CERTIFICATE_ADDRESS, KEEPER_ADDRESS, DEPLOYER_ADDRESS, RPC_URL.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, formatUnits, http, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (key, fallback = "") => process.env[key] ?? fallback;

const RPC = env("RPC_URL", "https://andromeda.metis.io/?owner=1088");
const USDC = env("USDC_ADDRESS");
const ARENA = env("ARENA_ADDRESS");
const CERT = env("CERTIFICATE_ADDRESS");
const KEEPER = env("KEEPER_ADDRESS");
const DEPLOYER =
  env("DEPLOYER_ADDRESS") ||
  (env("DEPLOYER_PRIVATE_KEY").startsWith("0x")
    ? privateKeyToAccount(env("DEPLOYER_PRIVATE_KEY")).address
    : "");

const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const client = createPublicClient({ chain, transport: http(RPC, { timeout: 15_000 }) });

const results = [];
const ok = (label, detail = "") => results.push({ pass: true, label, detail });
const bad = (label, detail = "") => results.push({ pass: false, label, detail });

const arenaAbi = [
  { type: "function", name: "modelCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "keeper", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "attemptFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint96" }] },
  { type: "function", name: "open", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "scenario", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  {
    type: "function",
    name: "mandateOf",
    stateMutability: "view",
    inputs: [{ name: "scenario", type: "uint16" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "getModel",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint8" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "label", type: "string" },
          { name: "mandateHash", type: "bytes32" },
          { name: "purse", type: "uint96" },
          { name: "attemptCount", type: "uint32" },
          { name: "breaker", type: "address" },
          { name: "brokenAt", type: "uint64" },
          { name: "broken", type: "bool" },
          { name: "configured", type: "bool" },
        ],
      },
    ],
  },
  { type: "function", name: "purseOf", stateMutability: "view", inputs: [{ name: "id", type: "uint8" }], outputs: [{ type: "uint96" }] },
];

const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
];

const code = (address) => client.getCode({ address });

async function main() {
  // 1. chain
  try {
    const id = await client.getChainId();
    id === 1088 ? ok("rpc", `chain ${id}`) : bad("rpc", `chain ${id}, expected 1088`);
  } catch (cause) {
    bad("rpc", String(cause.message ?? cause).slice(0, 120));
  }

  // 2. usdc
  if (!USDC) {
    bad("usdc address", "USDC_ADDRESS not set — confirm m.USDC from the Metis docs");
  } else {
    const bytecode = await code(USDC);
    if (!bytecode || bytecode === "0x") {
      bad("usdc contract", `no code at ${USDC}`);
    } else {
      const [decimals, symbol, balance] = await Promise.all([
        client.readContract({ address: USDC, abi: erc20Abi, functionName: "decimals" }),
        client.readContract({ address: USDC, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
        DEPLOYER
          ? client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [DEPLOYER] })
          : Promise.resolve(0n),
      ]);
      decimals === 6 ? ok("usdc decimals", "6") : bad("usdc decimals", `${decimals}, contract assumes 6`);
      ok("usdc", `${symbol} at ${USDC.slice(0, 10)}…`);
      if (DEPLOYER) {
        const needs = 10n * 5_000_000n + 1_000_000n;
        balance >= needs
          ? ok("usdc balance", `${formatUnits(balance, 6)} (need 51 for ten purses + fees)`)
          : bad("usdc balance", `${formatUnits(balance, 6)} — need at least 51`);
      }
    }
  }

  // 3. gas
  if (DEPLOYER) {
    const gas = await client.getBalance({ address: DEPLOYER });
    const enough = gas > 10n ** 17n; // 0.1 METIS is plenty for a pilot
    enough
      ? ok("gas balance", `${Number(formatUnits(gas, 18)).toFixed(4)} METIS`)
      : bad("gas balance", `${Number(formatUnits(gas, 18)).toFixed(4)} METIS — deploy needs gas`);
  }

  // 4. arena + certificate
  if (ARENA) {
    const bytecode = await code(ARENA);
    if (!bytecode || bytecode === "0x") bad("arena contract", `no code at ${ARENA}`);
    else {
      const [count, fee, open, keeper, scenario, mandateOnchain] = await Promise.all([
        client.readContract({ address: ARENA, abi: arenaAbi, functionName: "modelCount" }),
        client.readContract({ address: ARENA, abi: arenaAbi, functionName: "attemptFee" }),
        client.readContract({ address: ARENA, abi: arenaAbi, functionName: "open" }),
        client.readContract({ address: ARENA, abi: arenaAbi, functionName: "keeper" }),
        client.readContract({ address: ARENA, abi: arenaAbi, functionName: "scenario" }),
        client.readContract({ address: ARENA, abi: arenaAbi, functionName: "scenario" }).then((id) =>
          client.readContract({
            address: ARENA,
            abi: arenaAbi,
            functionName: "mandateOf",
            args: [id],
          })
        ),
      ]);
      count === 10n ? ok("arena models", "10 configured") : bad("arena models", `${count}`);
      ok("attempt fee", `$${formatUnits(fee, 6)}`);
      open ? ok("arena open", "accepting attempts") : bad("arena open", "closed");
      scenario > 0n ? ok("scenario", `scenario ${scenario} is live`) : bad("scenario", "no scenario opened");

      const policy = readFileSync(path.resolve(here, "../policy.txt"), "utf8").trim();
      const policyHash = keccak256(toHex(policy));
      mandateOnchain === policyHash
        ? ok("mandate hash", "scenario matches policy.txt")
        : bad("mandate hash", `${mandateOnchain} != ${policyHash}`);
      if (KEEPER) {
        keeper.toLowerCase() === KEEPER.toLowerCase()
          ? ok("keeper address", keeper)
          : bad("keeper address", `contract says ${keeper}, expected ${KEEPER}`);
      }

      const models = JSON.parse(readFileSync(path.resolve(here, "../models.json"), "utf8"));
      const keeperModels = JSON.parse(readFileSync(path.resolve(here, "../../keeper/models.json"), "utf8"));
      const sameOrder = models.every((label, index) => keeperModels[index]?.label === label);
      sameOrder ? ok("model order", "keeper/models.json matches chain order") : bad("model order", "keeper/models.json is out of order");

      let funded = 0n;
      for (let index = 0; index < Number(count); index++) {
        const model = await client.readContract({
          address: ARENA,
          abi: arenaAbi,
          functionName: "getModel",
          args: [index],
        });
        if (model.label !== models[index]) bad(`model ${index} label`, `${model.label}, expected ${models[index]}`);
        funded += model.purse;
      }
      funded > 0n ? ok("purses funded", `$${formatUnits(funded, 6)} under custody`) : bad("purses funded", "every purse is empty");
    }
  } else {
    bad("arena address", "ARENA_ADDRESS not set (expected before deploy)");
  }

  if (CERT) {
    const bytecode = await code(CERT);
    bytecode && bytecode !== "0x"
      ? ok("certificate contract", CERT.slice(0, 10) + "…")
      : bad("certificate contract", `no code at ${CERT}`);
  }

  // 5. report
  const width = 24;
  console.log("");
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.label.padEnd(width)} ${result.detail}`);
  }
  const failed = results.filter((result) => !result.pass).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
