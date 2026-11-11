/**
 * Verify MandateArena + BreakCertificate on the Metis Andromeda explorer.
 *
 *   node mandate/scripts/verify.mjs            # check bytecode match, then submit
 *   node mandate/scripts/verify.mjs --dry      # only check the local bytecode match
 *
 * The explorer will reject a submission whose compiled bytecode does not match what is deployed, so
 * this compiles first and compares against the artifact. If the check fails the problem is the
 * build settings, not the submission.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { encodeAbiParameters } from "viem";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const contractsDir = path.resolve(here, "../contracts");
const artifactsDir = path.resolve(here, "../artifacts");

const EXPLORER = "https://andromeda-explorer.metis.io/api";
const DEPLOYER = "0xd20b6ecb626DF04064771483bCD4C8aa210fbEC7";
const USDC = "0xEA32A96608495e54156Ae48931A7c20f0dcc1a21";
const CERTIFICATE = "0x0441b60c91bdd62f752a3bd8186ba8c0f7cd03cb";
const ARENA = "0x0c1fccb074913ea6ab337ca8a6c1d6fa4c40376d";
const dry = process.argv.includes("--dry");

/** Collect every source the compiler needs, resolving relative imports against the importer. */
const sources = {};
const diskCache = new Map();

function readDisk(key) {
  if (diskCache.has(key)) return diskCache.get(key);
  const candidates = key.startsWith("@")
    ? [path.join(root, "node_modules", key)]
    : [path.join(contractsDir, key), path.join(root, key)];
  const found = candidates.find((candidate) => existsSync(candidate));
  const content = found ? readFileSync(found, "utf8") : null;
  diskCache.set(key, content);
  return content;
}

function addSource(key, content) {
  if (sources[key] || content == null) return;
  sources[key] = { content };
  const dir = key.includes("/") ? key.slice(0, key.lastIndexOf("/")) : "";
  for (const match of content.matchAll(/import\s+(?:[^"']*?from\s+)?["']([^"']+)["']/g)) {
    const spec = match[1];
    const childKey = spec.startsWith(".")
      ? path.posix.normalize(path.posix.join(dir, spec))
      : spec;
    const child = readDisk(childKey);
    if (child == null) console.warn("unresolved import:", spec, "->", childKey);
    else addSource(childKey, child);
  }
}

for (const file of readdirSync(contractsDir)) {
  if (file.endsWith(".sol")) addSource(file, readFileSync(path.join(contractsDir, file), "utf8"));
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: () => ({ error: "unresolved" }) }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}

const targets = [
  {
    file: "MandateArena.sol",
    name: "MandateArena",
    address: ARENA,
    args: encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint96" }, { type: "uint64" }],
      [USDC, CERTIFICATE, DEPLOYER, 0n, 600n]
    ),
  },
  {
    file: "BreakCertificate.sol",
    name: "BreakCertificate",
    address: CERTIFICATE,
    args: encodeAbiParameters([{ type: "address" }], [DEPLOYER]),
  },
];

const compilerVersion = `v${solc.version().split("+")[0]}+commit.${solc.version().split("commit.")[1].split(".")[0]}`;

let mismatch = false;
for (const target of targets) {
  const compiled = output.contracts[target.file]?.[target.name];
  const artifact = JSON.parse(readFileSync(path.join(artifactsDir, `${target.name}.json`), "utf8"));
  const compiledDeployed = compiled?.evm?.deployedBytecode?.object ?? "";
  const artifactDeployed = (artifact.deployedBytecode ?? "").replace(/^0x/, "");
  const match = compiledDeployed === artifactDeployed;
  console.log(
    `${target.name.padEnd(18)} compiled ${compiledDeployed.length / 2} bytes, artifact ${artifactDeployed.length / 2} bytes -> ${match ? "MATCH" : "MISMATCH"}`
  );
  if (!match) mismatch = true;
  target.constructorArgs = target.args.replace(/^0x/, "");
  target.contractName = `${target.file}:${target.name}`;
}

console.log(`compiler ${compilerVersion}`);
if (mismatch) {
  console.error("\nbytecode does not match the artifacts: fix the build settings before submitting.");
  process.exit(1);
}
if (dry) {
  console.log("\ndry run complete; nothing submitted.");
  process.exit(0);
}

for (const target of targets) {
  const body = new URLSearchParams({
    module: "contract",
    action: "verifysourcecode",
    apikey: process.env.ETHERSCAN_KEY ?? "",
    contractaddress: target.address,
    sourceCode: JSON.stringify(input),
    codeformat: "solidity-standard-json-input",
    contractname: target.contractName,
    compilerversion: compilerVersion,
    constructorArguements: target.constructorArgs,
  });

  const response = await fetch(EXPLORER, { method: "POST", body });
  const text = await response.text();
  console.log(`\n${target.name} verify -> ${response.status}`);
  console.log(text.slice(0, 400));
}
