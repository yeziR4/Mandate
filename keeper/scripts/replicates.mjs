/**
 * Replicate stability: does a break rate reproduce, or does it flip between runs?
 *
 *   node keeper/scripts/replicates.mjs
 *
 * Every cell in the main study is a single observation, which is not enough to publish a rate.
 * This pools repeated runs of the same scenario and reports two things separately, because they
 * behave differently:
 *
 *   - per-cell: does this exact attacker/defender pair give the same verdict each time?
 *   - per-model: does the pooled break rate hold, and how wide is the interval?
 *
 * Writes replication.json.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const short = (model) => model.split("/").pop();

// Group every transcript by scenario. Replicates are simply multiple runs of one scenario.
const byScenario = new Map();
for (const name of readdirSync(root).filter((file) => /^duel-.*\.json$/.test(file))) {
  let data;
  try {
    data = JSON.parse(readFileSync(path.resolve(root, name), "utf8"));
  } catch {
    continue;
  }
  if (data.tooled !== true) continue; // chat-only runs are a different experiment
  const entry = byScenario.get(data.scenario) ?? { runs: [], files: [] };
  if (data.results?.length) {
    entry.runs.push(data);
    entry.files.push(name);
  }
  byScenario.set(data.scenario, entry);
}

const CI = 1.96;
const results = [];

for (const [scenario, entry] of [...byScenario.entries()].sort()) {
  if (entry.runs.length < 2) continue;

  const rates = entry.runs.map((run) => ({
    cells: run.results.length,
    breaks: run.results.filter((result) => result.worst === 3).length,
  }));

  const cellOutcomes = new Map();
  const defenderOutcomes = new Map();
  const attackerOutcomes = new Map();

  for (const run of entry.runs) {
    for (const result of run.results) {
      const key = `${short(result.attacker)} -> ${short(result.defender)}`;
      const broke = result.worst === 3 ? 1 : 0;
      cellOutcomes.set(key, [...(cellOutcomes.get(key) ?? []), broke]);
      defenderOutcomes.set(short(result.defender), [
        ...(defenderOutcomes.get(short(result.defender)) ?? []),
        broke,
      ]);
      attackerOutcomes.set(short(result.attacker), [
        ...(attackerOutcomes.get(short(result.attacker)) ?? []),
        broke,
      ]);
    }
  }

  const all = [...cellOutcomes.values()];
  const always = all.filter((values) => values.every((value) => value === 1)).length;
  const never = all.filter((values) => values.every((value) => value === 0)).length;
  const unstable = all.length - always - never;

  const summarise = (map) =>
    [...map.entries()]
      .map(([model, values]) => {
        const n = values.length;
        const p = values.reduce((sum, value) => sum + value, 0) / n;
        const se = Math.sqrt((p * (1 - p)) / n);
        return { model, n, breaks: values.reduce((sum, value) => sum + value, 0), rate: p, ci: CI * se };
      })
      .sort((a, b) => b.rate - a.rate);

  results.push({
    scenario,
    runs: rates,
    aggregate: rates.map((run) => run.breaks / run.cells),
    cells: { total: all.length, alwaysBreak: always, neverBreak: never, unstable },
    defenders: summarise(defenderOutcomes),
    attackers: summarise(attackerOutcomes),
    files: entry.files,
  });

  console.log(`\n== ${scenario} (${entry.runs.length} runs)`);
  console.log(
    `   break rate per run: ${rates.map((run) => `${run.breaks}/${run.cells}`).join(" | ")}`
  );
  console.log(
    `   cells: ${all.length} total | always ${always} | never ${never} | unstable ${unstable}`
  );
  for (const row of summarise(defenderOutcomes)) {
    console.log(
      `   defender ${row.model.padEnd(22)} ${String(row.breaks).padStart(2)}/${row.n}  ${(row.rate * 100).toFixed(0)}% +-${(row.ci * 100).toFixed(0)}pp`
    );
  }
}

const out = path.resolve(root, "replication.json");
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
console.log(`\nwritten ${path.relative(root, out)}`);
