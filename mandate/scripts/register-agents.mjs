/**
 * ERC-8004 agent registration — plan first, send only when told to.
 *
 *   node mandate/scripts/register-agents.mjs            # dry run: prints the plan + gas estimate
 *   node mandate/scripts/register-agents.mjs --execute  # sends one register() per model
 *
 * The dry run performs no transaction. It builds the exact registration file for each model,
 * encodes the exact calldata, and asks the node to estimate gas for it.
 *
 * Network, verified on chain 1088:
 *   IdentityRegistry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 *   (EIP-1967 proxy -> 0x7274e874ca62410a93bd8bf61c69d8045e399c02, name() = "AgentIdentity")
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (key, fallback = "") => process.env[key] ?? fallback;
const EXECUTE = process.argv.includes("--execute");

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const RPC = env("RPC_URL", "https://andromeda.metis.io/?owner=1088");
const PUBLIC_URL = env("PUBLIC_URL");
const URI_BASE = env("AGENT_URI_BASE");

const models = JSON.parse(readFileSync(path.resolve(here, "../models.json"), "utf8"));

const deploymentFile = path.resolve(here, `../deployments/${env("DEPLOYMENT_NAME", "metis")}.json`);
const deployment = existsSync(deploymentFile)
  ? JSON.parse(readFileSync(deploymentFile, "utf8"))
  : undefined;
const arena = env("ARENA_ADDRESS", deployment?.contracts?.MandateArena ?? "");

const key = env("DEPLOYER_PRIVATE_KEY");
const account = key.startsWith("0x") ? privateKeyToAccount(key) : undefined;
// gas estimation needs a sender; any address works on Andromeda's RPC
const estimator = env("ESTIMATOR_ADDRESS", account?.address ?? "0x0000000000000000000000000000000000000001");

const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
];

const publicClient = createPublicClient({ chain, transport: http(RPC) });

function registrationFile(label, index) {
  const services = [];
  if (PUBLIC_URL) services.push({ name: "web", endpoint: PUBLIC_URL });
  if (arena) services.push({ name: "contract", endpoint: `eip155:1088:${arena}` });

  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Mandate — ${label}`,
    description: `A treasury agent holding a real m.USDC purse on Metis under a written mandate. Scenario 1, agent ${index + 1} of ${models.length}. Break the mandate and the purse transfers to you.`,
    ...(PUBLIC_URL ? { image: `${PUBLIC_URL.replace(/\/$/, "")}/mark.svg` } : {}),
    services,
    x402Support: false,
    active: true,
    supportedTrust: ["reputation"],
  };
}

const toDataUri = (value) =>
  `data:application/json;base64,${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`;

async function main() {
  const chainId = await publicClient.getChainId();
  const gasPrice = await publicClient.getGasPrice();

  console.log(`network      ${chain.name} (chain ${chainId})`);
  console.log(`registry     ${REGISTRY}`);
  console.log(`arena        ${arena || "(not deployed yet — ARENA_ADDRESS unset)"}`);
  console.log(`uri mode     ${URI_BASE ? `https (${URI_BASE})` : "self-contained data: URI"}`);
  console.log(`gas price    ${Number(gasPrice) / 1e9} gwei`);
  console.log(`estimator    ${estimator}`);
  console.log(`mode         ${EXECUTE ? "EXECUTE (sends transactions)" : "dry run (no transactions)"}\n`);

  const plan = [];
  let totalGas = 0n;

  for (let index = 0; index < models.length; index++) {
    const label = models[index];
    const file = registrationFile(label, index);
    const uri = URI_BASE ? `${URI_BASE.replace(/\/$/, "")}/${label.toLowerCase()}.json` : toDataUri(file);

    const data = encodeFunctionData({ abi: registryAbi, functionName: "register", args: [uri] });
    let gas = 0n;
    try {
      gas = await publicClient.estimateGas({ account: estimator, to: REGISTRY, data });
      totalGas += gas;
    } catch (cause) {
      console.warn(`  ! gas estimate failed for ${label}: ${cause.message.split("\n")[0]}`);
    }

    plan.push({
      index,
      label,
      agentId: "assigned on registration",
      uriBytes: uri.length,
      estimatedGas: gas.toString(),
      metadata: file,
    });
  }

  for (const item of plan) {
    console.log(`#${String(item.index).padStart(2, "0")}  ${item.label.padEnd(9)} gas ${item.estimatedGas.padStart(9)}  uri ${item.uriBytes} bytes`);
  }

  // host the registration files so `agentURI` can be a short https URL instead of a data URI
  if (PUBLIC_URL) {
    const dir = path.resolve(here, "../../web/public/agents");
    mkdirSync(dir, { recursive: true });
    for (const item of plan) {
      writeFileSync(path.join(dir, `${item.label.toLowerCase()}.json`), JSON.stringify(item.metadata, null, 2));
    }
    console.log(`\nwrote ${plan.length} registration files to web/public/agents/`);
  }

  const gasCostWei = totalGas * gasPrice;
  console.log(`\ntotal gas    ${totalGas.toString()} units`);
  console.log(`total cost   ${formatEther(gasCostWei)} METIS at ${Number(gasPrice) / 1e9} gwei`);
  console.log(`allocation   ${Number(formatEther(gasCostWei)).toFixed(6)} METIS across ${plan.length} registrations\n`);
  console.log("sample registration file (#00):");
  console.log(JSON.stringify(plan[0]?.metadata, null, 2));

  mkdirSync(path.resolve(here, "../deployments"), { recursive: true });
  const outFile = path.resolve(here, `../deployments/agents-plan-${env("DEPLOYMENT_NAME", "metis")}.json`);
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        stage: EXECUTE ? "executed" : "plan",
        generatedAt: new Date().toISOString(),
        chainId,
        registry: REGISTRY,
        arena: arena || null,
        gasPriceWei: gasPrice.toString(),
        totalGas: totalGas.toString(),
        totalCostWei: gasCostWei.toString(),
        agents: plan,
      },
      null,
      2
    )
  );
  console.log(`\nwrote ${path.relative(path.resolve(here, "../.."), outFile)}`);

  if (!EXECUTE) {
    console.log("\nnothing was sent. re-run with --execute when you have approved the plan.");
    return;
  }

  if (!account) {
    console.error("DEPLOYER_PRIVATE_KEY missing — cannot execute");
    process.exit(1);
  }

  const wallet = createWalletClient({ account, chain, transport: http(RPC) });
  const registered = [];

  for (const item of plan) {
    const uri = URI_BASE
      ? `${URI_BASE.replace(/\/$/, "")}/${item.label.toLowerCase()}.json`
      : toDataUri(item.metadata);

    const hash = await wallet.writeContract({
      address: REGISTRY,
      abi: registryAbi,
      functionName: "register",
      args: [uri],
      account,
      chain,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`register reverted for ${item.label}`);

    const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const transfer = receipt.logs.find((log) => log.topics[0] === TRANSFER);
    const agentId = transfer?.topics[3] ? BigInt(transfer.topics[3]) : 0n;

    console.log(`${item.label.padEnd(9)} agentId ${agentId.toString().padEnd(4)} tx ${hash}`);
    registered.push({ ...item, agentId: agentId.toString(), tx: hash });
  }

  writeFileSync(
    path.resolve(here, `../deployments/agents-${env("DEPLOYMENT_NAME", "metis")}.json`),
    JSON.stringify({ chainId, registry: REGISTRY, registeredAt: new Date().toISOString(), agents: registered }, null, 2)
  );
  console.log("\nwrote agents file");
}

await main();
