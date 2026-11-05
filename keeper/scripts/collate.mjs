/**
 * Collate every duel-*.json transcript into one dataset for the visualization.
 *
 *   node keeper/scripts/collate.mjs
 *   node keeper/scripts/collate.mjs --out study-data.json
 *
 * A scenario can be spread across several files: a run that lost cells, then a repair pass that
 * filled the gaps. So this UNIONS cells across files per scenario, newest file first, and a pair
 * that appears twice keeps the completed record. Picking only the newest file would throw away
 * the repair pass and quietly shrink the matrix.
 *
 * Spend is summed across all files, including work that was thrown away, because it is money
 * that was actually spent.
 *
 * Pure ASCII on purpose.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const short = (model) => model.split("/").pop();
const mean = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

const files = readdirSync(root).filter((name) => /^duel-.*\.json$/.test(name));

const loaded = [];
for (const name of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(path.resolve(root, name), "utf8"));
  } catch {
    continue;
  }
  // Older runs predate the scenario field; they were all the canonical invoice policy.
  const scenario = data.scenario ?? "invoice";
  const stamp = data.ranAt ?? new Date(statSync(path.resolve(root, name)).mtimeMs).toISOString();
  loaded.push({ name, data, scenario, stamp });
}
loaded.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));

const byScenario = new Map();
for (const entry of loaded) {
  const bucket = byScenario.get(entry.scenario) ?? {
    files: [],
    cells: new Map(),
    expectedPairs: new Set(),
    spendUsd: 0,
    rounds: null,
    models: null,
    unreachable: new Map(),
    mandate: null,
  };
  bucket.files.push(entry.name);
  bucket.spendUsd += typeof entry.data.costUsd === "number" ? entry.data.costUsd : 0;
  bucket.rounds = Math.max(bucket.rounds ?? 0, entry.data.rounds ?? 0) || null;

  // The intended size of a scenario is the union of pairs any run in it meant to cover. Taking the
  // biggest single roster undercounts when a later run adds one model (a frontier arm, say).
  const runAttackers = entry.data.attackers ?? [];
  const runDefenders = entry.data.defenders ?? [];
  for (const attacker of runAttackers) {
    for (const defender of runDefenders) {
      if (attacker !== defender) bucket.expectedPairs.add(`${attacker}|${defender}`);
    }
  }
  if (runAttackers.length > (bucket.models?.length ?? 0)) {
    bucket.models = runAttackers;
  }
  bucket.defenders = runDefenders.length > (bucket.defenders?.length ?? 0) ? runDefenders : bucket.defenders;
  bucket.mandate = bucket.mandate ?? entry.data.mandate ?? null;
  for (const entryUnreachable of entry.data.unreachable ?? []) {
    bucket.unreachable.set(entryUnreachable.model, entryUnreachable.status);
  }

  // Newest files are visited first, so the first record for a pair is the one kept.
  for (const result of entry.data.results ?? []) {
    const key = `${result.attacker}|${result.defender}`;
    if (bucket.cells.has(key)) continue;
    bucket.cells.set(key, result);
  }

  byScenario.set(entry.scenario, bucket);
}

const scenarios = [];
const modelStats = new Map();

for (const [scenario, bucket] of [...byScenario.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const cells = [];
  let verdicts = 0;
  let fallbacks = 0;
  let disputed = 0;
  let confirmed = 0;

  for (const result of bucket.cells.values()) {
    const turns = result.turns ?? [];
    verdicts += turns.length;
    fallbacks += turns.filter((turn) => turn.judgeSource === "heuristic").length;
    disputed += turns.filter((turn) => turn.disputed).length;
    confirmed += turns.filter((turn) => turn.confirmedBy).length;
    const brokeAt = turns.find((turn) => turn.severity === 3)?.round ?? null;
    const worstTurn = turns.reduce(
      (best, turn) => (!best || turn.severity >= best.severity ? turn : best),
      null
    );

    cells.push({
      attacker: result.attacker,
      defender: result.defender,
      attackerShort: short(result.attacker),
      defenderShort: short(result.defender),
      worst: result.worst,
      rounds: turns.length,
      brokeAtRound: brokeAt,
      severities: turns.map((turn) => turn.severity),
      // Evidence for a single cell, so a chart can show the line a score came from.
      worstTurn: worstTurn
        ? {
            round: worstTurn.round,
            severity: worstTurn.severity,
            reason: worstTurn.reason,
            quote: worstTurn.quote ?? null,
            judgeSource: worstTurn.judgeSource,
            attack: String(worstTurn.attack ?? "").slice(0, 900),
            reply: String(worstTurn.reply ?? "").slice(0, 900),
          }
        : null,
    });

    for (const [role, model] of [
      ["attacker", result.attacker],
      ["defender", result.defender],
    ]) {
      const key = `${role}:${model}`;
      const stat = modelStats.get(key) ?? { role, model, worsts: [], breaks: 0, turns: 0 };
      stat.worsts.push(result.worst);
      stat.turns += turns.length;
      if (result.worst === 3) stat.breaks += 1;
      modelStats.set(key, stat);
    }
  }

  cells.sort(
    (a, b) => a.attacker.localeCompare(b.attacker) || a.defender.localeCompare(b.defender)
  );

  const expected = bucket.expectedPairs.size || null;

  scenarios.push({
    scenario,
    files: bucket.files,
    ranAt: null,
    rounds: bucket.rounds,
    mandate: bucket.mandate,
    models: bucket.models ?? [],
    defenders: bucket.defenders ?? bucket.models ?? [],
    unreachable: [...bucket.unreachable.entries()].map(([model, status]) => ({ model, status })),
    cells,
    expectedCells: expected,
    missingCells: expected ? Math.max(0, expected - cells.length) : null,
    verdicts,
    fallbacks,
    disputed,
    confirmed,
    breaks: cells.filter((cell) => cell.worst === 3).length,
    spendUsd: bucket.spendUsd,
  });
}

const models = [...modelStats.values()]
  .map((stat) => ({
    role: stat.role,
    model: stat.model,
    shortName: short(stat.model),
    cells: stat.worsts.length,
    meanWorst: mean(stat.worsts),
    maxWorst: Math.max(...stat.worsts),
    breaks: stat.breaks,
    verdicts: stat.turns,
  }))
  .sort((a, b) => a.role.localeCompare(b.role) || (b.meanWorst ?? 0) - (a.meanWorst ?? 0));

const totals = {
  scenarios: scenarios.length,
  cells: scenarios.reduce((sum, scenario) => sum + scenario.cells.length, 0),
  expectedCells: scenarios.reduce((sum, scenario) => sum + (scenario.expectedCells ?? 0), 0),
  missingCells: scenarios.reduce((sum, scenario) => sum + (scenario.missingCells ?? 0), 0),
  verdicts: scenarios.reduce((sum, scenario) => sum + scenario.verdicts, 0),
  breaks: scenarios.reduce((sum, scenario) => sum + scenario.breaks, 0),
  judgeFallbacks: scenarios.reduce((sum, scenario) => sum + scenario.fallbacks, 0),
  disputed: scenarios.reduce((sum, scenario) => sum + scenario.disputed, 0),
  confirmedBreaks: scenarios.reduce((sum, scenario) => sum + scenario.confirmed, 0),
  spendUsd: scenarios.reduce((sum, scenario) => sum + scenario.spendUsd, 0),
  models: new Set(models.map((entry) => entry.model)).size,
};

const payload = {
  generatedAt: new Date().toISOString(),
  gateway: loaded[0]?.data.baseUrl ?? null,
  totals,
  perVerdictUsd: totals.verdicts ? totals.spendUsd / totals.verdicts : null,
  scenarios,
  models,
};

const out = path.resolve(root, arg("out", "study-data.json"));
writeFileSync(out, JSON.stringify(payload, null, 2));

// Publish into the site so /study can read it as a static asset.
const webPublic = path.resolve(root, "web/public");
if (existsSync(webPublic)) {
  writeFileSync(path.join(webPublic, "study-data.json"), JSON.stringify(payload, null, 2));
  console.log(`published  ${path.relative(root, path.join(webPublic, "study-data.json"))}`);
}

console.log(`scenarios  ${totals.scenarios}`);
console.log(`cells      ${totals.cells}/${totals.expectedCells}${totals.missingCells ? ` (${totals.missingCells} missing)` : ""}`);
console.log(`verdicts   ${totals.verdicts}`);
console.log(`breaks     ${totals.breaks}`);
console.log(`fallbacks  ${totals.judgeFallbacks}`);
console.log(`spend      $${totals.spendUsd.toFixed(4)}${totals.verdicts ? ` ($${payload.perVerdictUsd.toFixed(5)} per verdict)` : ""}`);
console.log(`written    ${path.relative(root, out)}`);
