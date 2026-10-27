/**
 * Register each model as an ERC-8004 agent on Metis Andromeda.
 *
 * The registry is live on Andromeda at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 * (EIP-1967 proxy, implementation 0x7274e874ca62410a93bd8bf61c69d8045e399c02, `name()` = "AgentIdentity").
 * Verified from the chain, not from a blog post.
 *
 *   $env:DEPLOYER_PRIVATE_KEY="0x..."
 *   node mandate/scripts/register-agents.mjs
 *
 * Optional: AGENT_URI_BASE=https://your.site/agents  (otherwise a self-contained data: URI is used)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (key, fallback = "") => process.env[key] ?? fallback;

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const RPC = env("RPC_URL", "https://andromeda.metis.io/?owner=1088");
const KEY = env("DEPLOYER_PRIVATE_KEY");
const URI_BASE = env("AGENT_URI_BASE");

if (!KEY.startsWith("0x")) {
  console.error("DEPLOYER_PRIVATE_KEY missing");
  process.exit(1);
}

const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const account = privateKeyToAccount(KEY);
const publicClient = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });

const registryAbi = [
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
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
];

const models = JSON.parse(readFileSync(path.resolve(here, "../models.json"), "utf8"));
const deploymentFile = path.resolve(here, `../deployments/${env("DEPLOYMENT_NAME", "metis")}.json`);
const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));

const registrationFile = (label, index) =>
  JSON.stringify({
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `Mandate — ${label}`,
    description: `A treasury agent holding a real stablecoin purse on Metis under a written mandate. Attempt ${index + 1} of ${models.length} in the season.`,
    services: [
      {
        name: "web",
        endpoint: env("PUBLIC_URL", "https://mandate.example"),
      },
      {
        name: "arena",
        endpoint: `eip155:1088:${deployment.contracts.MandateArena}`,
      },
    ],
    x402Support: false,
    active: true,
    registrations: [],
    supportedTrust: ["reputation"],
  });

const toDataUri = (json) =>
  `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;

console.log(`registry ${REGISTRY}`);
console.log(`signer   ${account.address}\n`);

const registered = [];

for (let index = 0; index < models.length; index++) {
  const label = models[index];
  const json = registrationFile(label, index);
  const uri = URI_BASE ? `${URI_BASE.replace(/\/$/, "")}/${label.toLowerCase()}.json` : toDataUri(json);

  const hash = await wallet.writeContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "register",
    args: [uri],
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`register reverted for ${label}`);

  // the id is the ERC-721 token id; read it out of the Transfer log rather than trusting a decode
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const transfer = receipt.logs.find((log) => log.topics[0] === TRANSFER);
  if (!transfer?.topics[3]) throw new Error(`no Transfer log for ${label}`);
  const agentId = BigInt(transfer.topics[3]);
  const owner = await publicClient.readContract({
    address: REGISTRY,
    abi: registryAbi,
    functionName: "ownerOf",
    args: [agentId],
  });

  console.log(`${label.padEnd(9)} agentId ${agentId.toString().padEnd(4)} owner ${owner}`);
  registered.push({ index, label, agentId: agentId.toString(), tx: hash });
}

mkdirSync(path.resolve(here, "../deployments"), { recursive: true });
writeFileSync(
  path.resolve(here, `../deployments/agents-${env("DEPLOYMENT_NAME", "metis")}.json`),
  JSON.stringify(
    { chainId: 1088, registry: REGISTRY, registeredAt: new Date().toISOString(), agents: registered },
    null,
    2
  )
);
console.log(`\nwrote deployments/agents-${env("DEPLOYMENT_NAME", "metis")}.json`);
