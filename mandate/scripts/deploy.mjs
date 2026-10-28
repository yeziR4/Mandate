/**
 * Deploys MandateArena + BreakCertificate to Metis Andromeda (1088), configures the
 * ten models from models.json / policy.txt, hands the certificate over to the arena,
 * and optionally funds each purse with $5.
 *
 *   $env:DEPLOYER_PRIVATE_KEY="0x..."
 *   $env:USDC_ADDRESS="0x..."            # m.USDC on Andromeda — confirm from Metis docs
 *   $env:KEEPER_ADDRESS="0x..."          # optional, defaults to deployer
 *   $env:FUND_PURSES="true"              # optional, sends $5 per model
 *   node mandate/scripts/deploy.mjs
 *
 * Nothing here is audited. Pilot money only.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { metis } from "viem/chains";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.resolve(here, "../artifacts");

const RPC_URL = process.env.RPC_URL ?? "https://andromeda.metis.io/?owner=1088";
const ATTEMPT_FEE = parseUnits(process.env.ATTEMPT_FEE_USDC ?? "0", 6);
const COOLDOWN = 30n;
const OPENING_PURSE = parseUnits(process.env.OPENING_PURSE_USDC ?? "5", 6);

const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!privateKey || !privateKey.startsWith("0x")) {
  console.error("DEPLOYER_PRIVATE_KEY missing");
  process.exit(1);
}

// Verified on Andromeda: symbol "m.USDC", 6 decimals, read from the contract at runtime by preflight.
const DEFAULT_MUSDC = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21";
const usdc = process.env.USDC_ADDRESS ?? DEFAULT_MUSDC;
if (!usdc.startsWith("0x")) {
  console.error("USDC_ADDRESS is not an address");
  process.exit(1);
}

const account = privateKeyToAccount(privateKey);
const keeper = process.env.KEEPER_ADDRESS ?? account.address;

const chain = { ...metis, rpcUrls: { default: { http: [RPC_URL] } } };
const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const wallet = createWalletClient({ account, chain, transport: http(RPC_URL) });

const load = (name) => JSON.parse(readFileSync(path.join(artifacts, `${name}.json`), "utf8"));
const arenaArtifact = load("MandateArena");
const certArtifact = load("BreakCertificate");

const models = JSON.parse(readFileSync(path.resolve(here, "../models.json"), "utf8"));
const mandate = readFileSync(path.resolve(here, "../policy.txt"), "utf8").trim();
const mandateHash = keccak256(toHex(mandate));

async function deploy(artifact, args) {
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
    account,
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("no contract address");
  console.log(`deployed ${artifact.name} -> ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function call(address, abi, functionName, args) {
  const hash = await wallet.writeContract({ address, abi, functionName, args, account, chain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return receipt;
}

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
];

console.log(`deployer ${account.address}`);
console.log(`keeper   ${keeper}`);
console.log(`usdc     ${usdc}`);
console.log(`rpc      ${RPC_URL}\n`);

// The certificate starts owned by the deployer so the pair can be deployed in either
// order, then the deployer hands minting rights to the arena and loses them for good.
const certificate = await deploy(certArtifact, [account.address]);
const arena = await deploy(arenaArtifact, [usdc, certificate, keeper, ATTEMPT_FEE, COOLDOWN]);

await call(certificate, certArtifact.abi, "setArena", [arena]);
console.log("certificate arena -> arena (deployer can no longer mint)");

for (let i = 0; i < models.length; i++) {
  await call(arena, arenaArtifact.abi, "configureModel", [i, models[i], mandateHash]);
  console.log(`model ${i} ${models[i]}`);
}

// one live scenario: every standing model is given this exact mandate, at the same time
await call(arena, arenaArtifact.abi, "openScenario", [mandateHash]);
console.log("scenario 1 opened — identical mandate for every model");

// the promise attached to a break; paid separately at settlement
const bounty = parseUnits(process.env.BOUNTY_USDC ?? "5", 6);
await call(arena, arenaArtifact.abi, "setBounty", [bounty]);
console.log(`bounty set to ${process.env.BOUNTY_USDC ?? "5"} m.USDC per break`);

if (process.env.CERT_BASE_URI) {
  await call(arena, arenaArtifact.abi, "setCertificateBaseURI", [process.env.CERT_BASE_URI]);
  console.log(`certificate baseURI -> ${process.env.CERT_BASE_URI}`);
}

if (process.env.FUND_PURSES === "true") {
  const total = OPENING_PURSE * BigInt(models.length);
  const balance = await publicClient.readContract({
    address: usdc, abi: erc20, functionName: "balanceOf", args: [account.address],
  });
  if (balance < total) {
    console.error(`not enough USDC: have ${balance}, need ${total}`);
    process.exit(1);
  }
  await call(usdc, erc20, "approve", [arena, total]);
  for (let i = 0; i < models.length; i++) {
    await call(arena, arenaArtifact.abi, "fundPurse", [i, OPENING_PURSE]);
    console.log(`purse ${models[i]} -> ${OPENING_PURSE / 1000000n} USDC`);
  }
}

await call(arena, arenaArtifact.abi, "setOpen", [true]);
console.log("\narena open\n");

const out = {
  chainId: 1088,
  deployment: process.env.DEPLOYMENT_NAME ?? "metis",
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  keeper,
  usdc,
  attemptFee: ATTEMPT_FEE.toString(),
  cooldownSeconds: Number(COOLDOWN),
  mandateHash,
  contracts: { MandateArena: arena, BreakCertificate: certificate },
  models,
};
mkdirSync(path.resolve(here, "../deployments"), { recursive: true });
const file = path.resolve(here, `../deployments/${out.deployment}.json`);
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`wrote ${path.relative(path.resolve(here, "../.."), file)}`);
console.log("\nForm fields:");
console.log(`  ${arena}`);
console.log(`  ${certificate}`);
