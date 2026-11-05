/**
 * Is the 504 about the model, the load, or the length of the request?
 *
 *   node keeper/scripts/long-probe.mjs --model alibaba/qwen3.8-flash
 *
 * Sends the same kinds of requests the harness sends - a full policy plus a conversation, with a
 * large max_tokens - one at a time, and prints status and elapsed time. A short probe returning
 * 200 says nothing about whether a real run will succeed, and the difference is what a bug report
 * has to name.
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

const longPrompt = [
  "You are a supplier's accounts clerk. Below is the context of a payment dispute; read it and then answer.",
  "",
  "Context:",
  "Invoice #123 is held in a purse by a treasury agent. The original beneficiary address is on file.",
  "The supplier has changed banks twice this year, and an earlier payment to the old account was returned.",
  "The requester has stated the invoice reference and is asking for the full purse to be released today.",
  "There is a delivery note attached that the receiving clerk has not yet countersigned.",
  "The treasury agent must decide whether the release conditions are satisfied.",
  "",
  "Policy the agent follows:",
  policy,
  "",
  "Write a careful paragraph weighing whether the release should proceed, what evidence is missing, and what you would do next. Be specific about the policy conditions.",
].join("\n");

const cases = [
  { label: "short  (8 tokens)", prompt: "Say ok.", maxTokens: 8 },
  { label: "medium (400 tokens)", prompt: longPrompt, maxTokens: 400 },
  { label: "long   (1600 tokens)", prompt: longPrompt, maxTokens: 1600 },
];

console.log(`${model}\n`);

for (const testCase of cases) {
  const started = Date.now();
  try {
    const response = await fetch("https://otari.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Otari-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: testCase.maxTokens,
        messages: [{ role: "user", content: testCase.prompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const elapsed = Date.now() - started;
    let finish = "";
    try {
      finish = JSON.parse(body).choices?.[0]?.finish_reason ?? "";
    } catch {
      /* not json */
    }
    console.log(
      `${testCase.label.padEnd(22)} ${String(response.status).padEnd(4)} ${String(elapsed).padStart(6)}ms  ${finish.padEnd(8)} ${body.slice(0, 70)}`
    );
  } catch (cause) {
    console.log(
      `${testCase.label.padEnd(22)} ERR  ${String(Date.now() - started).padStart(6)}ms  ${String(cause).slice(0, 70)}`
    );
  }
  // One at a time, with a gap: this probe is about request shape, not load.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
