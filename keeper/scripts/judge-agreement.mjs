/**
 * How good are these models at judging?
 *
 *   node keeper/scripts/judge-agreement.mjs --file duel-invoice-123.json --limit 40
 *
 * Scores the same saved turns with several judge models and reports how often they agree. The
 * question that matters for a benchmark is not exact-score agreement but whether they agree on
 * the one decision that pays money: is this a break or not.
 *
 * Judges must not be models under test. Pass them with --judges, comma separated.
 *
 * Pure ASCII on purpose.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeWith } from "../judge.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const file = arg("file");
if (!file) {
  console.error("usage: judge-agreement.mjs --file duel-*.json [--judges a,b,c] [--limit 40]");
  process.exit(1);
}

const judges = arg(
  "judges",
  "mistralai/mistral-small-4,nvidia/nemotron-3-super-120b-a12b,meta/llama-4-scout-17b,bytedance/seed-2.0-mini"
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const limit = Number(arg("limit", "40"));

const data = JSON.parse(readFileSync(path.resolve(root, file), "utf8"));
const turns = [];
for (const result of data.results ?? []) {
  for (const turn of result.turns ?? []) {
    turns.push({
      defender: result.defender,
      round: turn.round,
      attack: turn.attack,
      reply: turn.reply,
      recorded: turn.severity,
    });
  }
}

// Deterministic sample. With --stratify, turns that scored above zero are taken first, so the
// sample is not dominated by refusals: agreement on 24 clean refusals says nothing.
const step = Math.max(1, Math.floor(turns.length / limit));
let sample = turns.filter((_, index) => index % step === 0).slice(0, limit);
if (args.includes("--stratify")) {
  const interesting = turns.filter((turn) => turn.recorded > 0);
  const clean = turns.filter((turn) => turn.recorded === 0);
  sample = [...interesting, ...clean].slice(0, Math.max(limit, interesting.length));
}
const positives = sample.filter((turn) => turn.recorded === 3).length;
const nonZero = sample.filter((turn) => turn.recorded > 0).length;

console.log(
  `${file}: ${turns.length} turns, scoring ${sample.length} with ${judges.length} judges` +
    ` (${nonZero} recorded above zero, ${positives} recorded as breaks)\n`
);

const scores = new Map();
for (const judgeModel of judges) {
  scores.set(judgeModel, []);
}

for (const turn of sample) {
  const row = [];
  for (const judgeModel of judges) {
    const verdict = await judgeWith(judgeModel, turn.defender, turn.attack, turn.reply);
    scores.get(judgeModel).push(verdict.severity);
    row.push(`${verdict.severity}${verdict.source === "heuristic" ? "h" : ""}`);
  }
  console.log(`  round ${String(turn.round).padStart(2)}  recorded ${turn.recorded}  ->  ${row.join("  ")}`);
}

// Cohen's kappa on the binary decision that matters: break or not.
function kappa(a, b) {
  const n = a.length;
  let observed = 0;
  let aYes = 0;
  let bYes = 0;
  let bothYes = 0;
  let bothNo = 0;
  for (let i = 0; i < n; i++) {
    const ay = a[i] === 3;
    const by = b[i] === 3;
    if (ay) aYes++;
    if (by) bYes++;
    if (ay === by) observed++;
    if (ay && by) bothYes++;
    if (!ay && !by) bothNo++;
  }
  const po = observed / n;
  const pe = (aYes / n) * (bYes / n) + ((n - aYes) / n) * ((n - bYes) / n);
  return { po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), bothYes, bothNo };
}

const summary = [];
for (let i = 0; i < judges.length; i++) {
  for (let j = i + 1; j < judges.length; j++) {
    const a = scores.get(judges[i]);
    const b = scores.get(judges[j]);
    const exact = a.filter((value, index) => value === b[index]).length / a.length;
    const stat = kappa(a, b);
    summary.push({
      pair: [judges[i], judges[j]],
      exactAgreement: exact,
      breakAgreement: stat.po,
      kappa: stat.kappa,
      breaksCalledByFirst: a.filter((value) => value === 3).length,
      breaksCalledBySecond: b.filter((value) => value === 3).length,
    });
    console.log(
      `\n${judges[i].split("/").pop()} vs ${judges[j].split("/").pop()}: exact ${(exact * 100).toFixed(0)}% | break/no-break ${(stat.po * 100).toFixed(0)}% | kappa ${stat.kappa.toFixed(2)}`
    );
  }
}

console.log("");
for (const judgeModel of judges) {
  const values = scores.get(judgeModel);
  const breaks = values.filter((value) => value === 3).length;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  console.log(
    `${judgeModel.padEnd(44)} mean ${mean.toFixed(2)} | breaks ${String(breaks).padStart(2)}/${values.length}`
  );
}

const out = path.resolve(root, arg("out", `judge-agreement-${Date.now()}.json`));
writeFileSync(
  out,
  JSON.stringify({ file, sampleSize: sample.length, judges, scores: Object.fromEntries(scores), summary }, null, 2)
);
console.log(`\nwritten ${path.relative(root, out)}`);
