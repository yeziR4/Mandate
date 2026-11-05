/**
 * Rejudge a saved duel transcript under the current rubric.
 *
 *   node --experimental-strip-types keeper/scripts/rejudge.mjs duel-1234.json
 *
 * Why this exists: a judge is a measuring instrument, and instruments drift. When the rubric
 * changes, previously published numbers must be reproducible rather than silently replaced.
 * This re-scores every turn in a saved file and prints what changed and why.
 *
 * Pure ASCII on purpose: edited from Windows shells that mangle punctuation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { judge } from "../judge.ts";

const file = process.argv[2];
const write = process.argv.includes("--write");
const onlyBreaks = process.argv.includes("--only-breaks");
if (!file) {
  console.error("usage: rejudge.mjs <duel-file.json> [--write]");
  process.exit(1);
}

const data = JSON.parse(readFileSync(path.resolve(file), "utf8"));

let changed = 0;
let total = 0;
let disputed = 0;

for (const result of data.results ?? []) {
  console.log(`\n${result.attacker} -> ${result.defender}`);

  let worst = 0;
  for (const turn of result.turns ?? []) {
    if (onlyBreaks && turn.severity !== 3) continue;
    total++;
    const verdict = await judge(result.defender, turn.attack, turn.reply);
    worst = Math.max(worst, verdict.severity);
    if (verdict.disputed) disputed++;

    if (verdict.severity === turn.severity) {
      console.log(`  round ${turn.round}  ${turn.severity} -> ${verdict.severity}  unchanged`);
      // A second opinion can still confirm or dispute a break without moving the number.
      if (write) {
        turn.disputed = verdict.disputed ?? false;
        turn.confirmedBy = verdict.confirmedBy ?? null;
        turn.secondOpinion = verdict.secondOpinion ?? null;
      }
    } else {
      changed++;
      console.log(`  round ${turn.round}  ${turn.severity} -> ${verdict.severity}  CHANGED`);
      console.log(`    was: ${turn.reason}`);
      console.log(`    now: ${verdict.reason}`);
      console.log(`    quote: ${verdict.quote}`);
      if (write) {
        turn.severity = verdict.severity;
        turn.reason = verdict.reason;
        turn.quote = verdict.quote;
        turn.judgeSource = verdict.source;
        turn.disputed = verdict.disputed ?? false;
        turn.confirmedBy = verdict.confirmedBy ?? null;
        turn.secondOpinion = verdict.secondOpinion ?? null;
      }
    }
  }

  if (worst !== result.worst) {
    console.log(`  pair worst ${result.worst} -> ${worst}`);
    if (write) result.worst = worst;
  }
}

if (write) {
  data.rejudgedAt = new Date().toISOString();
  data.rubric = process.env.JUDGE_MODEL ?? data.rubric ?? null;
  writeFileSync(path.resolve(file), JSON.stringify(data, null, 2));
  console.log(`\nwritten ${file}`);
}

console.log(`\n${changed}/${total} verdicts changed under the current rubric${disputed ? `, ${disputed} disputed` : ""}`);
