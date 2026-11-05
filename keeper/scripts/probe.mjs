/**
 * Probe a gateway's models and record what actually answered.
 *
 *   node keeper/scripts/probe.mjs --base https://otari.ai/api/v1 --key otk_... --all
 *   node keeper/scripts/probe.mjs --models deepseek/deepseek-v4.1-flash,z-ai/glm-5.3-flash
 *
 * For each model it records: HTTP status, the model id the gateway says answered, latency, and
 * whether that id differs from the one requested. A benchmark needs the last field, because an
 * answer from a model that was not under test is not a measurement.
 *
 * Output is JSON on stdout so it can be diffed between runs and charted later.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

let baseUrl = arg("base", "https://otari.ai/api/v1").replace(/\/$/, "");
let apiKey = arg("key");

// Fall back to .env.mandate so the key never has to pass through a shell.
if (!apiKey) {
  try {
    const text = readFileSync(".env.mandate", "utf8");
    const match = text.match(/^OTARI_API_KEY=(.*)$/m) ?? text.match(/^RIVER_KEY=(.*)$/m);
    apiKey = match?.[1]?.trim() ?? "";
  } catch {
    /* no env file */
  }
}
if (!apiKey) {
  console.error("no key: pass --key or set OTARI_API_KEY in .env.mandate");
  process.exit(1);
}

const authMode = baseUrl.includes("otari") ? "otari" : "bearer";
const headers = {
  "Content-Type": "application/json",
  ...(authMode === "otari" ? { "Otari-Key": apiKey } : { authorization: `Bearer ${apiKey}` }),
};

async function listModels() {
  const response = await fetch(`${baseUrl}/models`, { headers });
  if (!response.ok) throw new Error(`/models returned ${response.status}`);
  const body = await response.json();
  return (body.data ?? []).map((model) => ({
    id: model.id,
    inPrice: model.pricing?.input_price_per_million,
    outPrice: model.pricing?.output_price_per_million,
  }));
}

async function probe(model, timeoutMs = 45000) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
      }),
    });
    const text = await response.text();
    const latencyMs = Date.now() - started;

    let answered = null;
    let detail = "";
    try {
      const body = JSON.parse(text);
      answered = body.model ?? null;
      detail = body.detail ? JSON.stringify(body.detail).slice(0, 120) : body.error?.message ?? "";
    } catch {
      // Non-JSON body: usually an HTML error page from the edge.
      detail = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    }

    return {
      model,
      status: response.status,
      ok: response.ok,
      answeredBy: answered,
      substituted: Boolean(answered && answered !== model),
      latencyMs,
      detail,
    };
  } catch (cause) {
    return {
      model,
      status: 0,
      ok: false,
      answeredBy: null,
      substituted: false,
      latencyMs: Date.now() - started,
      detail: String(cause).slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

const explicit = arg("models");
let targets;
if (explicit) {
  targets = explicit.split(",").map((id) => ({ id: id.trim() })).filter((entry) => entry.id);
} else if (args.includes("--all")) {
  targets = await listModels();
} else {
  const catalog = await listModels();
  console.log(JSON.stringify({ baseUrl, catalogSize: catalog.length, models: catalog }, null, 2));
  process.exit(0);
}

const concurrency = Number(arg("concurrency", "4"));
const results = [];
for (let i = 0; i < targets.length; i += concurrency) {
  const batch = targets.slice(i, i + concurrency);
  const probed = await Promise.all(batch.map((entry) => probe(entry.id)));
  results.push(...probed.map((result, index) => ({ ...result, inPrice: batch[index].inPrice, outPrice: batch[index].outPrice })));
  for (const result of probed) {
    const verdict = result.substituted
      ? `SUBSTITUTED -> ${result.answeredBy}`
      : result.ok
        ? "ok"
        : `${result.status} ${result.detail.slice(0, 60)}`;
    console.error(`${result.model.padEnd(52)} ${String(result.latencyMs).padStart(6)}ms  ${verdict}`);
  }
}

const up = results.filter((result) => result.ok && !result.substituted);
const substituted = results.filter((result) => result.substituted);
const down = results.filter((result) => !result.ok);

console.error("");
console.error(`${up.length} answering | ${substituted.length} substituted | ${down.length} down`);

const payload = {
  baseUrl,
  probedAt: new Date().toISOString(),
  counts: { up: up.length, substituted: substituted.length, down: down.length },
  results,
};

// --out writes the file directly: PowerShell redirection writes UTF-16 and corrupts JSON.
const out = arg("out");
if (out) {
  writeFileSync(out, JSON.stringify(payload, null, 2));
  console.error(`written ${out}`);
} else {
  console.log(JSON.stringify(payload, null, 2));
}
