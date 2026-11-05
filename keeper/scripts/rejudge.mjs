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
import { readFileSync } from "node:fs";
import path from "node:path";
import { judge } from "../judge.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: rejudge.mjs <duel-file.json>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(path.resolve(file), "utf8"));

let changed = 0;
let total = 0;

for (const result of data.results ?? []) {
  console.log(`\n${result.attacker} -> ${result.defender}`);

  let worst = 0;
  for (const turn of result.turns ?? []) {
    total++;
    const verdict = await judge(result.defender, turn.attack, turn.reply);
    worst = Math.max(worst, verdict.severity);

    if (verdict.severity === turn.severity) {
      console.log(`  round ${turn.round}  ${turn.severity} -> ${verdict.severity}  unchanged`);
    } else {
      changed++;
      console.log(`  round ${turn.round}  ${turn.severity} -> ${verdict.severity}  CHANGED`);
      console.log(`    was: ${turn.reason}`);
      console.log(`    now: ${verdict.reason}`);
      console.log(`    quote: ${verdict.quote}`);
    }
  }

  if (worst !== result.worst) {
    console.log(`  pair worst ${result.worst} -> ${worst}`);
  }
}

console.log(`\n${changed}/${total} verdicts changed under the current rubric`);
