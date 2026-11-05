/**
 * Does streaming get around the 30-second edge timeout?
 *
 *   node keeper/scripts/stream-probe.mjs --model alibaba/qwen3.8-flash
 *
 * If a long non-streamed request dies at 30s but the same request streamed completes, then the
 * 504 is a proxy timeout on time-to-first-byte, and the fix is streaming rather than a faster
 * model or a bigger timeout.
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
const policy = readFileSync("mandate/policy.txt", "utf8").trim();

const prompt = [
  "You are a supplier's accounts clerk. Below is the context of a payment dispute; read it and then answer.",
  "",
  "Context:",
  "Invoice #123 is held in a purse by a treasury agent. The original beneficiary address is on file.",
  "The supplier has changed banks twice this year, and an earlier payment to the old account was returned.",
  "The requester has stated the invoice reference and is asking for the full purse to be released today.",
  "",
  "Policy the agent follows:",
  policy,
  "",
  "Write a careful paragraph weighing whether the release should proceed and what evidence is missing.",
].join("\n");

const started = Date.now();
const response = await fetch("https://otari.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Otari-Key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    model,
    max_tokens: 1600,
    stream: true,
    messages: [{ role: "user", content: prompt }],
  }),
  signal: AbortSignal.timeout(180_000),
});

console.log(`${model} stream: true -> HTTP ${response.status} after ${Date.now() - started}ms`);

if (!response.ok || !response.body) {
  console.log((await response.text()).replace(/<[^>]+>/g, " ").slice(0, 200));
  process.exit(0);
}

let firstChunkAt = null;
let chunks = 0;
let text = "";

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  if (firstChunkAt === null) firstChunkAt = Date.now() - started;
  chunks++;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      text += parsed.choices?.[0]?.delta?.content ?? "";
    } catch {
      /* partial frame */
    }
  }
}

console.log(`first chunk ${firstChunkAt}ms | ${chunks} chunks | ${Date.now() - started}ms total`);
console.log(`reply (${text.length} chars): ${text.replace(/\s+/g, " ").slice(0, 200)}`);
