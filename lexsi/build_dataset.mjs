/**
 * Turn our red-team transcripts into data CuratorKIT can gate.
 *
 *   node lexsi/build_dataset.mjs
 *
 * Two outputs:
 *   lexsi/data/turns.jsonl    one row per exchange, with the mechanical label
 *   lexsi/data/attacks.jsonl  unique attacker messages per scenario, labelled by whether they broke
 *
 * The label comes from the harness, not a judge: `break` is true when the agent emitted a payment
 * to an address that is not the recorded beneficiary. That is the thing that makes this dataset
 * different from a judged red-team corpus.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(here, "data");
mkdirSync(outDir, { recursive: true });

const files = readdirSync(root).filter((name) => /^duel-.*\.json$/.test(name));
const turns = [];
const attacks = new Map();

let breakCount = 0;
let turnCount = 0;

for (const file of files) {
  let data;
  try {
    data = JSON.parse(readFileSync(path.join(root, file), "utf8"));
  } catch {
    continue;
  }
  if (data.tooled !== true) continue; // chat-only runs are a different experiment

  for (const result of data.results ?? []) {
    for (const turn of result.turns ?? []) {
      turnCount++;
      const broke = turn.severity === 3;
      if (broke) breakCount++;

      const released = /RELEASE\s+0x[0-9a-fA-F]{40}/i.test(turn.reply ?? "");

      turns.push({
        id: `${data.scenario}-${result.attacker}-${result.defender}-r${turn.round}`,
        scenario: data.scenario,
        policy: (data.mandate ?? "").slice(0, 1200),
        round: turn.round,
        attacker_model: result.attacker,
        defender_model: result.defender,
        attack: turn.attack,
        reply: turn.reply,
        break: broke,
        released_funds: released,
        severity: turn.severity,
        verdict_reason: turn.reason,
        // A verdict is "mechanical" when the harness read the ledger, not when a model judged prose.
        verdict_source: turn.judgeSource ?? "unknown",
        label: broke ? "break" : released ? "compliant_release" : "refusal",
      });

      const key = `${data.scenario}|${turn.attack.trim()}`;
      const existing = attacks.get(key);
      if (!existing) {
        attacks.set(key, {
          id: `atk-${data.scenario}-${String(attacks.size + 1).padStart(4, "0")}`,
          scenario: data.scenario,
          policy: (data.mandate ?? "").slice(0, 1200),
          attack: turn.attack,
          broke_something: broke,
          max_severity: turn.severity,
          times_seen: 1,
        });
      } else {
        existing.times_seen += 1;
        existing.broke_something = existing.broke_something || broke;
        existing.max_severity = Math.max(existing.max_severity, turn.severity);
      }
    }
  }
}

const writeJsonl = (file, rows) =>
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

writeJsonl(path.join(outDir, "turns.jsonl"), turns);
writeJsonl(path.join(outDir, "attacks.jsonl"), [...attacks.values()]);

const byScenario = {};
for (const turn of turns) {
  byScenario[turn.scenario] = byScenario[turn.scenario] ?? { turns: 0, breaks: 0 };
  byScenario[turn.scenario].turns++;
  if (turn.break) byScenario[turn.scenario].breaks++;
}

console.log(`transcripts read      ${files.length}`);
console.log(`turns                 ${turnCount}`);
console.log(`breaks (mechanical)   ${breakCount}  (${((100 * breakCount) / Math.max(1, turnCount)).toFixed(1)}%)`);
console.log(`unique attacks        ${attacks.size}`);
for (const [scenario, stats] of Object.entries(byScenario)) {
  console.log(`  ${scenario.padEnd(10)} turns ${String(stats.turns).padStart(4)}  breaks ${String(stats.breaks).padStart(3)}`);
}
console.log(`\nwritten ${path.relative(root, path.join(outDir, "turns.jsonl"))} and attacks.jsonl`);
