/**
 * Diagnose the config files without printing any secret.
 *   node mandate/scripts/check-env.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const files = [".env.mandate", ".env.local", ".env"];
const wanted = ["KEEPER_PRIVATE_KEY", "PRIVATE_KEY", "RIVER_KEY", "MODEL_GLM_API_KEY", "ARENA_ADDRESS"];

for (const name of files) {
  const file = path.join(root, name);
  console.log(`\n=== ${name} ===`);
  if (!existsSync(file)) {
    console.log("missing");
    continue;
  }

  const buffer = readFileSync(file);
  const head = [...buffer.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  let encoding = "utf8";
  if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = "utf16le";
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = "utf16be";
  else if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) encoding = "utf8-bom";

  console.log(`bytes ${buffer.length} · first4 [${head}] · looks like ${encoding}`);

  const text = encoding.startsWith("utf16")
    ? buffer.toString("utf16le")
    : buffer.toString("utf8").replace(/^\uFEFF/, "");

  const parsed = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) parsed.set(match[1], match[2].replace(/^["']|["']$/g, ""));
  }

  console.log(`parsed ${parsed.size} key=value line(s)`);
  for (const key of wanted) {
    if (!parsed.has(key)) {
      console.log(`  ${key.padEnd(20)} absent`);
      continue;
    }
    const value = parsed.get(key);
    const shape =
      value.startsWith("0x") && value.length === 66
        ? `ok (66 chars, 0x)`
        : value.startsWith("rv_")
          ? `ok (river key, ${value.length} chars)`
          : value.startsWith("0x")
            ? `BAD length ${value.length} (need 66)`
            : `${value.length} chars, does not start with 0x`;
    console.log(`  ${key.padEnd(20)} present · ${shape}`);
  }
}

console.log("\n(no secret values printed)");
