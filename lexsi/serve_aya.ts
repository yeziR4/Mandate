/**
 * Start a local OpenAI-compatible server for Tiny Aya.
 *
 *   node lexsi/serve_aya.ts
 *   node lexsi/serve_aya.ts --model lexsi/models/tiny-aya-global-q4_k_m.gguf --port 8080
 *
 * We serve the GGUF quant through llama.cpp rather than transformers for two practical reasons:
 * the quantised file is ~2 GB instead of ~7 GB on a slow link, and llama.cpp is several times
 * faster on CPU. The agent harness cannot tell the difference - it speaks the same protocol.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const args = process.argv.slice(2);
const arg = (name: string, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const model = path.resolve(root, arg("model", "lexsi/models/tiny-aya-global-q4_k_m.gguf"));
const port = arg("port", "8080");
const threads = arg("threads", "10");
const context = arg("context", "4096");

const server = path.resolve(root, "lexsi/bin/llama/llama-server.exe");

if (!existsSync(server)) {
  console.error(`missing llama-server at ${server}`);
  console.error("download: https://github.com/ggml-org/llama.cpp/releases (bin-win-cpu-x64.zip)");
  process.exit(1);
}
if (!existsSync(model)) {
  console.error(`missing model at ${model}`);
  process.exit(1);
}

console.log(`serving ${path.basename(model)} on http://127.0.0.1:${port}/v1`);
console.log(`threads ${threads} · context ${context}\n`);

const child = spawn(
  server,
  [
    "-m", model,
    "--port", port,
    "--host", "127.0.0.1",
    "-t", threads,
    "-c", context,
    // Aya ships its own chat template; llama.cpp reads it from the GGUF metadata.
    "--jinja",
    "-n", "512",
    "--no-warmup",
  ],
  { stdio: "inherit", cwd: root }
);

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
