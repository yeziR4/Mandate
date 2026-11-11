/**
 * Fix double-encoded punctuation.
 *
 * Several files went through a Windows PowerShell round-trip that read UTF-8 as ANSI, which turns
 * "·" into "Â·" and "—" into "â€”". Cosmetic, but visible on a landing page.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOTS = ["web/src", "web/index.html"];
const REPLACEMENTS = [
  ["Â·", "·"],
  ["â€”", "—"],
  ["â€“", "–"],
  ["â€œ", "“"],
  ["â€\u009d", "”"],
  ["â€™", "’"],
  ["â€¦", "…"],
  ["\uFFFD?\"", "—"],
  ["Â ", " "],
];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.(tsx|ts|css|html)$/.test(entry)) fix(full);
  }
}

let touched = 0;
function fix(file) {
  let text = readFileSync(file, "utf8");
  const before = text;
  for (const [from, to] of REPLACEMENTS) {
    text = text.split(from).join(to);
  }
  if (text !== before) {
    writeFileSync(file, text);
    touched++;
    console.log("fixed", file);
  }
}

for (const root of ROOTS) {
  const stat = statSync(root);
  if (stat.isDirectory()) walk(root);
  else fix(root);
}
console.log(`${touched} file(s) repaired`);
