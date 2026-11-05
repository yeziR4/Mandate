/**
 * Collate every duel-*.json transcript into one dataset for the visualization.
 *
 *   node keeper/scripts/collate.mjs
 *   node keeper/scripts/collate.mjs --out study-data.json
 *
 * Emits one record per scenario, one row per cell, and per-model attacker / defender scores.
 * Everything the charts need is derived here so the charts never recompute a number twice.
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
const byScenario = new Map();

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
  const existing = byScenario.get(scenario);
  // Keep the most recently run file per scenario, by recorded time rather than by filename.
  if (!existing || stamp > existing.stamp) {
    byScenario.set(scenario, { name, data, stamp });
  }
}

const scenarios = [];
const modelStats = new Map();

for (const [scenario, { name, data }] of [...byScenario.entries()]) {
  const cells = [];
  let spendUsd = 0;
  let verdicts = 0;
  let fallbacks = 0;

  for (const result of data.results ?? []) {
    const turns = result.turns ?? [];
    verdicts += turns.length;
    fallbacks += turns.filter((turn) => turn.judgeSource === "heuristic").length;
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
            attack: String(worstTurn.attack ?? "").slice(0, 600),
            reply: String(worstTurn.reply ?? "").slice(0, 600),
          }
        : null,
    });

    for (const [role, model] of [
      ["attacker", result.attacker],
      ["defender", result.defender],
    ]) {
      const key = `${role}:${model}`;
      const entry = modelStats.get(key) ?? { role, model, worsts: [], breaks: 0, turns: 0 };
      entry.worsts.push(result.worst);
      entry.turns += turns.length;
      if (result.worst === 3) entry.breaks += 1;
      modelStats.set(key, entry);
    }
  }

  // Per-scenario spend: a file is one scenario, so the whole file's spend belongs to it.
  spendUsd = typeof data.costUsd === "number" ? data.costUsd : 0;

  scenarios.push({
    scenario,
    file: name,
    ranAt: data.ranAt ?? null,
    rounds: data.rounds ?? null,
    mandate: data.mandate ?? null,
    models: data.attackers ?? [],
    unreachable: data.unreachable ?? [],
    cells,
    verdicts,
    fallbacks,
    breaks: cells.filter((cell) => cell.worst === 3).length,
    spendUsd,
  });
}

scenarios.sort((a, b) => a.scenario.localeCompare(b.scenario));

const models = [...modelStats.values()]
  .map((entry) => ({
    role: entry.role,
    model: entry.model,
    shortName: short(entry.model),
    cells: entry.worsts.length,
    meanWorst: mean(entry.worsts),
    maxWorst: Math.max(...entry.worsts),
    breaks: entry.breaks,
    verdicts: entry.turns,
  }))
  .sort((a, b) => a.role.localeCompare(b.role) || (b.meanWorst ?? 0) - (a.meanWorst ?? 0));

const totals = {
  scenarios: scenarios.length,
  cells: scenarios.reduce((sum, scenario) => sum + scenario.cells.length, 0),
  verdicts: scenarios.reduce((sum, scenario) => sum + scenario.verdicts, 0),
  breaks: scenarios.reduce((sum, scenario) => sum + scenario.breaks, 0),
  judgeFallbacks: scenarios.reduce((sum, scenario) => sum + scenario.fallbacks, 0),
  spendUsd: scenarios.reduce((sum, scenario) => sum + scenario.spendUsd, 0),
  models: new Set(models.map((entry) => entry.model)).size,
};

const payload = {
  generatedAt: new Date().toISOString(),
  gateway: [...byScenario.values()][0]?.data.baseUrl ?? null,
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
console.log(`cells      ${totals.cells}`);
console.log(`verdicts   ${totals.verdicts}`);
console.log(`breaks     ${totals.breaks}`);
console.log(`fallbacks  ${totals.judgeFallbacks}`);
console.log(`spend      $${totals.spendUsd.toFixed(4)}${totals.verdicts ? ` ($${payload.perVerdictUsd.toFixed(5)} per verdict)` : ""}`);
console.log(`written    ${path.relative(root, out)}`);
