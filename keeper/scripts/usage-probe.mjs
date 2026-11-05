/**
 * Does a streamed response still report token usage? Cost accounting depends on it.
 *
 *   node keeper/scripts/usage-probe.mjs --model alibaba/qwen3.8-flash
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const keyMatch = readFileSync(".env.mandate", "utf8").match(/^OTARI_API_KEY=(.*)$/m);
const apiKey = arg("key", keyMatch ? keyMatch[1].trim() : "");
const model = arg("model", "alibaba/qwen3.8-flash");

const response = await fetch("https://otari.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Otari-Key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    max_tokens: 60,
    stream: true,
    stream_options: { include_usage: true },
    messages: [{ role: "user", content: "Say hello in one word." }],
  }),
  signal: AbortSignal.timeout(90_000),
});

const text = await response.text();
const frames = text.split("\n").filter((line) => line.trim().startsWith("data:"));
const usageFrames = frames.filter((line) => line.includes("usage"));

console.log(`status ${response.status} | ${frames.length} frames | ${usageFrames.length} with usage`);
for (const frame of usageFrames.slice(0, 2)) {
  console.log(frame.slice(0, 320));
}
if (usageFrames.length === 0) {
  console.log("no usage frames: cost accounting would lose token counts when streaming");
}

// Look for the actual counters rather than the word "usage", which also appears in field names.
const counters = text.match(/"(prompt_tokens|completion_tokens|total_tokens)":\s*\d+/g) ?? [];
console.log(`token counters in stream: ${counters.length ? counters.join(", ") : "none"}`);
