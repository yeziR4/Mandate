/**
 * Fill the holes a run left behind.
 *
 *   node keeper/scripts/gapfill.mjs
 *   node keeper/scripts/gapfill.mjs --scenario payroll --concurrency 2
 *
 * A provider that sheds load turns a cell into nothing, and a missing cell is not a clean
 * defence. This reads the collated dataset, works out which attacker/defender pairs have no
 * verdict, and re-runs only those, one pair per process so each cell gets a single conversation
 * rather than competing with its neighbours for the same provider.
 *
 * Run collate.mjs again afterwards; it unions the new files into the existing matrix.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const only = arg("scenario");
const concurrency = Number(arg("concurrency", "2"));
const data = JSON.parse(readFileSync(path.resolve(root, "study-data.json"), "utf8"));

const plan = [];
for (const scenario of data.scenarios) {
  if (only && scenario.scenario !== only) continue;
  const attackers = scenario.models ?? [];
  const defenders = scenario.defenders ?? attackers;
  if (attackers.length === 0) continue;
  const have = new Set(scenario.cells.map((cell) => `${cell.attacker}|${cell.defender}`));
  // A single-cell smoke run is not a gap; only fill scenarios that were meant to be a matrix.
  if (attackers.length * defenders.length - attackers.filter((a) => defenders.includes(a)).length < 2) {
    continue;
  }
  for (const attacker of attackers) {
    for (const defender of defenders) {
      if (attacker === defender) continue;
      if (have.has(`${attacker}|${defender}`)) continue;
      plan.push({ scenario: scenario.scenario, attacker, defender, rounds: scenario.rounds ?? 6 });
    }
  }
}

if (plan.length === 0) {
  console.log("no gaps to fill");
  process.exit(0);
}

console.log(`${plan.length} missing cell(s), ${concurrency} at a time`);

function run(job) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", path.resolve(root, "keeper/scripts/duel.mjs")],
      {
        cwd: root,
        env: {
          ...process.env,
          DUEL_SCENARIO: job.scenario,
          DUEL_ATTACKERS: job.attacker,
          DUEL_DEFENDERS: job.defender,
          DUEL_ROUNDS: String(job.rounds),
          DUEL_CONCURRENCY: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("close", (code) => {
      const line = out
        .split(/\r?\n/)
        .find((entry) => entry.includes("worst ") || entry.includes("failed:")) ?? "";
      console.log(
        `${job.scenario.padEnd(9)} ${job.attacker.split("/").pop().padEnd(20)} -> ${job.defender
          .split("/")
          .pop()
          .padEnd(20)} ${code === 0 ? line.trim() : `exit ${code} ${line.trim()}`}`
      );
      resolve();
    });
  });
}

let next = 0;
async function worker() {
  while (next < plan.length) {
    const job = plan[next++];
    await run(job);
  }
}

await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, plan.length)) }, () => worker()));

console.log("\ngaps attempted. Re-run collate.mjs to merge them in.");
