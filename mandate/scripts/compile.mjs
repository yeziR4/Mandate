/**
 * Compiles mandate/contracts with solc-js and writes ABIs + bytecode to mandate/artifacts.
 * Run: node mandate/scripts/compile.mjs
 */
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, "../contracts");
const repoRoot = path.resolve(here, "../..");
const outDir = path.resolve(here, "../artifacts");

const sources = {};
for (const file of fs.readdirSync(contractsDir)) {
  if (!file.endsWith(".sol")) continue;
  sources[file] = { content: fs.readFileSync(path.join(contractsDir, file), "utf8") };
}

function findImports(importPath) {
  const candidates = [
    path.join(repoRoot, "node_modules", importPath),
    path.join(contractsDir, importPath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }
  return { error: "not found: " + importPath };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    // Metis Andromeda does not support Cancun opcodes (MCOPY). Target Shanghai.
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImports })
);

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
const warnings = (output.errors ?? []).filter((e) => e.severity === "warning");
for (const w of warnings) console.warn("warning:", w.formattedMessage.trim());
if (errors.length) {
  for (const e of errors) console.error(e.formattedMessage);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, artifact] of Object.entries(contracts)) {
    if (!artifact.evm.bytecode.object) continue; // interfaces
    if (!["MandateArena", "BreakCertificate"].includes(name)) continue; // only our contracts
    const target = path.join(outDir, `${name}.json`);
    fs.writeFileSync(
      target,
      JSON.stringify(
        {
          name,
          source: file,
          abi: artifact.abi,
          bytecode: "0x" + artifact.evm.bytecode.object,
          deployedBytecode: "0x" + artifact.evm.deployedBytecode.object,
        },
        null,
        2
      )
    );
    console.log(`ok  ${name}  -> ${path.relative(repoRoot, target)}`);
  }
}
console.log(`\nsolc ${solc.version()}`);
