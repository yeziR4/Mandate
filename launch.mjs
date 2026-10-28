/**
 * One command for the whole launch, in the safe order.
 *
 *   node launch.mjs                 # preflight + deploy + registration plan (spends nothing on ERC-8004)
 *   node launch.mjs --skip-deploy   # only re-run the checks and the plan
 *
 * It never sends ERC-8004 registrations. That stays a separate, deliberate `--execute`.
 */
import { spawnSync } from "node:child_process";

const steps = [];
const skipDeploy = process.argv.includes("--skip-deploy");

function run(label, command, args, { optional = false } = {}) {
  console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  const ok = result.status === 0;
  steps.push({ label, ok, optional });
  if (!ok && !optional) {
    console.error(`\n${label} failed. Stop and fix this before continuing.`);
    process.exit(1);
  }
  return ok;
}

console.log("Mandate launch\n");
console.log(`node ${process.version} · cwd ${process.cwd()}`);

const key = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const keyState = key.startsWith("0x") ? `set (${key.length} chars)` : "MISSING";
console.log(`signer key   ${keyState}`);
if (!key.startsWith("0x")) {
  console.log("");
  console.log("  Set it in THIS window, then re-run:");
  console.log('    $env:DEPLOYER_PRIVATE_KEY="0x..."');
  console.log("  Environment variables do not carry across shells or new windows.");
  console.log("");
}

run("Contracts: build + test", "node", ["mandate/scripts/compile.mjs"]);
run("Contracts: forge test", "forge", ["test", "--root", "mandate"], { optional: true });
run("Preflight: chain, USDC, funding", "node", ["mandate/scripts/preflight.mjs"], { optional: true });

if (!skipDeploy) {
  run("Deploy arena + certificate", "node", ["mandate/scripts/deploy.mjs"]);
  run("Preflight again, now with addresses", "node", ["mandate/scripts/preflight.mjs"]);
}

run("ERC-8004 registration plan (sends nothing)", "node", ["mandate/scripts/register-agents.mjs"], {
  optional: true,
});

console.log("\n" + "─".repeat(64));
for (const step of steps) {
  console.log(`${step.ok ? "PASS" : step.optional ? "SKIP" : "FAIL"}  ${step.label}`);
}

console.log(`
Still yours to do:

  1. Vercel: root directory web/, env VITE_ARENA_ADDRESS, VITE_CERTIFICATE_ADDRESS,
     VITE_USDC_ADDRESS, VITE_PRIVY_APP_ID, VITE_KEEPER_URL (after the keeper is up).
  2. Privy dashboard: allow the production origin.
  3. Keeper: fly deploy (see fly.toml), then GET /health.
  4. ERC-8004: review mandate/AGENTS.md, regenerate with the real PUBLIC_URL, then
     node mandate/scripts/register-agents.mjs --execute
  5. Submit the form with the addresses from mandate/deployments/metis.json.
`);
