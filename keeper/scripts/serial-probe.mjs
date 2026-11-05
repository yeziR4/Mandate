/**
 * Serial probe: is a model failing on its own, or only under load?
 *
 *   node keeper/scripts/serial-probe.mjs
 *   node keeper/scripts/serial-probe.mjs --model alibaba/qwen3.8-flash --n 5
 *
 * One request at a time, no retries, with timing and the raw body of any failure. This is the
 * evidence needed to tell "the provider is down" apart from "we were too parallel", and it is
 * the difference between a fair bug report and a wasted one.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const keyMatch = readFileSync(".env.mandate", "utf8").match(/^OTARI_API_KEY=(.*)$/m);
const apiKey = arg("key", keyMatch ? keyMatch[1].trim() : "");
if (!apiKey) {
  console.error("no key");
  process.exit(1);
}

const models = arg(
  "model",
  "alibaba/qwen3.8-flash,openai/gpt-oss-120b,xiaomi/mimo-v2.6-flash,deepseek/deepseek-v4.1-flash"
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const n = Number(arg("n", "3"));

for (const model of models) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    const started = Date.now();
    try {
      const response = await fetch("https://otari.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Otari-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 8,
          messages: [{ role: "user", content: "reply ok" }],
        }),
        signal: AbortSignal.timeout(75_000),
      });
      const body = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const elapsed = Date.now() - started;
      seen.push(response.status);
      console.log(
        `${new Date().toISOString().slice(11, 19)}  ${model.padEnd(32)} ${String(response.status).padEnd(4)} ${String(elapsed).padStart(6)}ms  ${body.slice(0, 90)}`
      );
    } catch (cause) {
      seen.push("ERR");
      console.log(
        `${new Date().toISOString().slice(11, 19)}  ${model.padEnd(32)} ERR  ${String(Date.now() - started).padStart(6)}ms  ${String(cause).slice(0, 80)}`
      );
    }
  }
  console.log(`  -> ${model}: ${seen.join(", ")}\n`);
}
