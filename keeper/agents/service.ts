/**
 * Always-on agents.
 *
 * An agent is a task, a schedule and a model. It wakes up, does one run, records what it cost, and
 * goes back to sleep. The model is a setting you can change between runs, which is the whole point
 * of routing through a gateway: same agent, different engine, priced per run.
 *
 * Storage is two JSON files. A pilot does not need a database, and a file you can open is a file a
 * judge can inspect.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callModel } from "../agent/model.ts";
import { runAgent } from "../agent/loop.ts";
import { SCENARIOS } from "../agent/scenarios.ts";
import { WATCH_TOOLS } from "../agent/tools.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const dataDir = path.resolve(root, "data");

export interface AgentDef {
  id: string;
  name: string;
  task: string;
  model: string;
  everyMinutes: number;
  enabled: boolean;
  kind: "watch" | "treasury";
  createdAt: string;
  lastRunAt?: string;
}

export interface AgentRun {
  id: string;
  agentId: string;
  model: string;
  startedAt: string;
  ms: number;
  output: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  ok: boolean;
  error?: string;
}

const agentsFile = path.join(dataDir, "agents.json");
const runsFile = path.join(dataDir, "runs.json");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

export const listAgents = (): AgentDef[] => readJson<AgentDef[]>(agentsFile, []);
export const listRuns = (): AgentRun[] => readJson<AgentRun[]>(runsFile, []);

export function saveAgent(agent: AgentDef) {
  const agents = listAgents();
  const index = agents.findIndex((entry) => entry.id === agent.id);
  if (index >= 0) agents[index] = agent;
  else agents.push(agent);
  writeJson(agentsFile, agents);
}

export function deleteAgent(id: string) {
  writeJson(
    agentsFile,
    listAgents().filter((agent) => agent.id !== id)
  );
}

export function recentRuns(agentId: string, limit = 12): AgentRun[] {
  return listRuns()
    .filter((run) => run.agentId === agentId)
    .slice(-limit)
    .reverse();
}

/** Prices come from the gateway's own catalogue, cached for the process. */
let priceCache: Map<string, { in: number; out: number }> | null = null;

async function prices(): Promise<Map<string, { in: number; out: number }>> {
  if (priceCache) return priceCache;
  const map = new Map<string, { in: number; out: number }>();
  try {
    const baseUrl = (process.env.OTARI_BASE_URL ?? "https://otari.ai/api/v1").replace(/\/$/, "");
    const apiKey = process.env.OTARI_API_KEY ?? "";
    const response = await fetch(`${baseUrl}/models`, {
      headers: baseUrl.includes("otari") ? { "Otari-Key": apiKey } : { authorization: `Bearer ${apiKey}` },
    });
    if (response.ok) {
      const body = (await response.json()) as {
        data?: Array<{ id: string; pricing?: { input_price_per_million?: number; output_price_per_million?: number } }>;
      };
      for (const model of body.data ?? []) {
        if (model.pricing?.input_price_per_million != null) {
          map.set(model.id, {
            in: Number(model.pricing.input_price_per_million),
            out: Number(model.pricing.output_price_per_million ?? 0),
          });
        }
      }
    }
  } catch {
    /* pricing unavailable: cost reports null rather than a guess */
  }
  priceCache = map;
  return map;
}

export async function runOnce(agent: AgentDef): Promise<AgentRun> {
  const baseUrl = process.env.OTARI_BASE_URL ?? "https://otari.ai/api/v1";
  const apiKey = process.env.OTARI_API_KEY ?? "";
  const authMode = baseUrl.includes("otari") ? ("otari" as const) : ("bearer" as const);
  const started = Date.now();

  const run: AgentRun = {
    id: `run_${started.toString(36)}`,
    agentId: agent.id,
    model: agent.model,
    startedAt: new Date(started).toISOString(),
    ms: 0,
    output: "",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: null,
    ok: false,
  };

  try {
    if (agent.kind === "treasury") {
      const scenario = SCENARIOS.invoice;
      const result = await runAgent({
        baseUrl,
        apiKey,
        authMode,
        scenario,
        model: agent.model,
        request: agent.task,
        maxSteps: 5,
      });
      run.output =
        result.events
          .filter((event) => event.kind === "tool_call")
          .map((event) => `${event.tool}(${JSON.stringify(event.args).slice(0, 90)})`)
          .join("\n") +
        (result.finalText ? `\n\n${result.finalText}` : "");
      run.promptTokens = result.promptTokens;
      run.completionTokens = result.completionTokens;
      run.ok = result.stoppedReason !== "error";
      if (result.error) run.error = result.error;
    } else {
      // Watch agents get the network and nothing else. They are always-on, so a run must produce
      // an observation about the world, not a promise to check something later.
      const watchScenario = {
        name: "watch",
        policy: [
          "You are an always-on agent. Each run you wake up, do your job once, and report.",
          "Use http_get to look at real pages. Do not claim you cannot access the internet.",
          "Report concretely: what you fetched, what the numbers were, and what you would do next.",
          "Keep it under 120 words.",
        ].join(" "),
        treasury: { balance: 0, currency: "n/a" },
        invoices: [],
      };

      const result = await runAgent({
        baseUrl,
        apiKey,
        authMode,
        scenario: watchScenario,
        model: agent.model,
        request: `${agent.task}\n\nRun time: ${new Date().toISOString()}`,
        maxSteps: 7,
        tools: WATCH_TOOLS,
      });

      const fetched = result.events
        .filter((event) => event.kind === "tool_call" && event.tool === "http_get")
        .map((event) => String((event.args as { url?: string })?.url ?? ""))
        .filter(Boolean);

      run.output = (fetched.length ? `fetched: ${fetched.join(", ")}\n\n` : "") + result.finalText;
      run.promptTokens = result.promptTokens;
      run.completionTokens = result.completionTokens;
      run.ok = result.stoppedReason !== "error";
      if (result.error) run.error = result.error;
    }

    const table = await prices();
    const price = table.get(agent.model);
    if (price) {
      run.costUsd = (run.promptTokens * price.in + run.completionTokens * price.out) / 1e6;
    }
  } catch (cause) {
    run.error = String(cause).slice(0, 300);
  }

  run.ms = Date.now() - started;
  const runs = listRuns();
  runs.push(run);
  writeJson(runsFile, runs.slice(-400));

  agent.lastRunAt = run.startedAt;
  saveAgent(agent);

  return run;
}

/** Is this agent due for a run? */
export function isDue(agent: AgentDef, now = Date.now()): boolean {
  if (!agent.enabled) return false;
  if (!agent.lastRunAt) return true;
  const last = Date.parse(agent.lastRunAt);
  return Number.isFinite(last) && now - last >= agent.everyMinutes * 60_000;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** The scheduler. One tick every 20s; runs are short and there are never many agents. */
export function startScheduler(onRun?: (run: AgentRun) => void) {
  if (timer) return;
  timer = setInterval(async () => {
    for (const agent of listAgents()) {
      if (!isDue(agent)) continue;
      const run = await runOnce(agent);
      onRun?.(run);
    }
  }, 20_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
