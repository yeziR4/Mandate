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

/** An HTTPS API the owner attached themselves. The agent gets one tool per connector. */
export interface CustomConnector {
  name: string;
  /** Base URL. Calls are confined to this origin and path prefix. */
  url: string;
  /** What it is for, in the owner's words. This is what the model reads. */
  description: string;
  /** Optional auth header. Stored on the keeper, never sent back to a browser. */
  header?: { name: string; value: string };
}

export interface AgentDef {
  id: string;
  /** The visitor this agent belongs to. Agents without one are the templates new visitors get. */
  owner?: string;
  /** Composio toolkits this agent may use. Undefined on old records: every curated toolkit. */
  connectors?: string[];
  custom?: CustomConnector[];
  name: string;
  /** What the person sees on the card. Plain language. */
  task: string;
  /** Machine detail appended to the run only: exact URLs, output format. Never displayed. */
  hint?: string;
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
  /** The message that triggered this run, when a person sent one. Absent for scheduled runs. */
  prompt?: string;
  /** Why it ran: on its schedule, or because someone asked. */
  trigger?: "schedule" | "person";
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  ok: boolean;
  error?: string;
}

const agentsFile = path.join(dataDir, "agents.json");
const runsFile = path.join(dataDir, "runs.json");
const visitorsFile = path.join(dataDir, "visitors.json");

/** The agents every new visitor starts with, and the apps each one needs. */
const TEMPLATE_CONNECTORS: Record<string, string[]> = {
  ag_watch: [],
  ag_jobs: [],
  ag_inbox: ["gmail"],
};

/** Limits that keep one browser from running up the shared gateway bill. */
export const MAX_AGENTS_PER_VISITOR = 8;
export const MIN_EVERY_MINUTES = 5;

/**
 * A visitor's agents keep waking for this long after the visitor was last seen, then rest until
 * they come back. 0 means never rest. Every run is paid for by the deployment, not the visitor,
 * so a public demo should not keep working for browsers that left days ago.
 */
const activeHours = () => {
  const value = Number(process.env.PUP_ACTIVE_HOURS ?? 24);
  return Number.isFinite(value) && value >= 0 ? value : 24;
};

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

interface VisitorRecord {
  seededAt: string;
  lastSeen: string;
}

let visitors: Record<string, VisitorRecord> | null = null;
let visitorsSavedAt = 0;

function visitorTable(): Record<string, VisitorRecord> {
  if (!visitors) visitors = readJson<Record<string, VisitorRecord>>(visitorsFile, {});
  return visitors;
}

/**
 * The agents that belong to one visitor. A browser seen for the first time gets its own copies of
 * the templates, so nobody shares a thread with anybody else. They are due at once, which means a
 * new visitor watches them do their first run instead of reading someone else's history.
 */
export function agentsFor(user: string): AgentDef[] {
  const table = visitorTable();
  const now = new Date().toISOString();
  const known = table[user];

  if (!known) {
    table[user] = { seededAt: now, lastSeen: now };
    writeJson(visitorsFile, table);
    visitorsSavedAt = Date.now();

    const all = listAgents();
    const suffix = Math.random().toString(36).slice(2, 8);
    for (const template of all.filter((agent) => !agent.owner && agent.id in TEMPLATE_CONNECTORS)) {
      all.push({
        ...template,
        id: `${template.id}_${suffix}`,
        owner: user,
        connectors: TEMPLATE_CONNECTORS[template.id],
        enabled: true,
        createdAt: now,
        lastRunAt: undefined,
      });
    }
    writeJson(agentsFile, all);
  } else {
    known.lastSeen = now;
    // The page polls every few seconds; the file only needs to be roughly right.
    if (Date.now() - visitorsSavedAt > 5 * 60_000) {
      writeJson(visitorsFile, table);
      visitorsSavedAt = Date.now();
    }
  }

  return listAgents().filter((agent) => agent.owner === user);
}

/** One agent, only if this visitor owns it. */
export function ownedAgent(id: string | undefined, user: string): AgentDef | null {
  if (!id) return null;
  return listAgents().find((agent) => agent.id === id && agent.owner === user) ?? null;
}

function ownerIsActive(agent: AgentDef, now: number): boolean {
  if (!agent.owner) return false; // templates are copied, never run
  const hours = activeHours();
  if (hours === 0) return true;
  const seen = Date.parse(visitorTable()[agent.owner]?.lastSeen ?? "");
  return Number.isFinite(seen) && now - seen < hours * 3_600_000;
}

/**
 * A fresh container has no data volume contents, so the first boot would show an empty product.
 * Seed the demo agents once; anything the user creates afterwards is theirs.
 */
export function seedAgents(): void {
  if (listAgents().length > 0) return;
  const now = new Date().toISOString();

  const seed: AgentDef[] = [
    {
      id: "ag_watch",
      name: "ETH price watch",
      task: "Check the ETH price in USD and flag it if it drops below $2,000.",
      hint: "Use http_get once with https://api.coinbase.com/v2/prices/ETH-USD/spot . Reply with one sentence: the price, and whether it is below 2000.",
      model: "deepseek/deepseek-v4.1-flash",
      everyMinutes: 30,
      enabled: true,
      kind: "watch",
      createdAt: now,
    },
    {
      id: "ag_jobs",
      name: "Hiring scout",
      task: "List the three most recent hiring posts on Hacker News.",
      hint: "Use http_get once with https://hn.algolia.com/api/v1/search?tags=story&query=hiring&hitsPerPage=3&attributesToRetrieve=title,points . Reply with three lines, one per post: title, then points in brackets. No other text.",
      model: "z-ai/glm-5.3-flash",
      everyMinutes: 60,
      enabled: true,
      kind: "watch",
      createdAt: now,
    },
    {
      id: "ag_inbox",
      name: "Inbox digest",
      task: "Summarise the unread mail in my inbox in three lines or fewer.",
      hint: "Read the six most recent unread messages using whichever Gmail read tool is available (prefer the GMAIL_ tool over any local one). Reply with one line per message: sender, then what it wants. If there is nothing unread, say so in one line.",
      model: "alibaba/qwen3.8-flash",
      everyMinutes: 60,
      enabled: true,
      kind: "watch",
      createdAt: now,
    },
  ];

  writeJson(agentsFile, seed);
  writeJson(runsFile, []);
}

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

/**
 * Tools a watch agent gets: web fetch, plus whatever connector toolkit is wired up.
 * Composio wins over the built-in IMAP reader when both are present, so the demo runs on one
 * connector layer rather than two.
 */
async function watchTools(agent: AgentDef, asked = ""): Promise<unknown[]> {
  const own = (agent.custom ?? []).map(customTool);
  const { composioConfigured, composioTools } = await import("./composio.ts");
  if (!composioConfigured()) return [...WATCH_TOOLS, ...own];
  try {
    const { tools, slugs } = await composioTools(agent.connectors, `${asked} ${agent.task}`.trim());
    if (slugs.size === 0) return [...WATCH_TOOLS, ...own];
    const gmailOwned = [...slugs].some((slug) => slug.startsWith("GMAIL_"));
    const local = WATCH_TOOLS.filter((tool) => {
      const name = (tool as { function?: { name?: string } }).function?.name;
      return !(gmailOwned && name === "gmail_list");
    });
    return [...local, ...tools, ...own];
  } catch {
    return [...WATCH_TOOLS, ...own];
  }
}

/** The tool name a custom connector is exposed under. Lower case, so it never looks like a Composio slug. */
export const customToolName = (connector: CustomConnector) =>
  `api_${connector.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "custom"}`;

function customTool(connector: CustomConnector) {
  return {
    type: "function",
    function: {
      name: customToolName(connector),
      description: `${connector.description} Reads from ${connector.url}.`.slice(0, 500),
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path and query string to add to the base URL, for example /v1/items?limit=5. Empty for the base URL itself.",
          },
        },
      },
    },
  };
}

export async function runOnce(agent: AgentDef, message?: string, userId?: string): Promise<AgentRun> {
  const baseUrl = process.env.OTARI_BASE_URL ?? "https://otari.ai/api/v1";
  const apiKey = process.env.OTARI_API_KEY ?? "";
  const authMode = baseUrl.includes("otari") ? ("otari" as const) : ("bearer" as const);
  const started = Date.now();
  const asked = message?.trim();

  const run: AgentRun = {
    id: `run_${started.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    agentId: agent.id,
    model: agent.model,
    startedAt: new Date(started).toISOString(),
    ms: 0,
    output: "",
    prompt: asked || undefined,
    trigger: asked ? "person" : "schedule",
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
        userId,
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
          "You are an always-on agent reporting to your owner.",
          "Use http_get to look at the page you were told to check.",
          "Reply with the finding only, in the shortest form that answers the job.",
          "Never mention tools, requests, HTTP status, truncation, parsing, or what you would do next.",
          "Never apologise or explain your process. If something was unavailable, say what you could not get in one clause and stop.",
          "Two sentences maximum unless the job asks for a list.",
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
        request: `${asked ? `${asked}\n\nRemember: ` : ""}${agent.task}${agent.hint ? `\n\n${agent.hint}` : ""}\n\nRun time: ${new Date().toISOString()}`,
        maxSteps: 7,
        tools: await watchTools(agent, asked),
        userId,
        custom: agent.custom,
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
  writeJson(runsFile, runs.slice(-5000));

  // Re-read before saving: the owner may have swapped the model or paused it while this ran.
  const current = listAgents().find((entry) => entry.id === agent.id);
  if (current) {
    current.lastRunAt = run.startedAt;
    saveAgent(current);
  }

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
  let ticking = false;
  timer = setInterval(async () => {
    // A slow pass must not overlap the next one, or the same agent runs twice.
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const due = listAgents().filter((agent) => ownerIsActive(agent, now) && isDue(agent));
      // A few at a time: one slow agent must not hold up every other visitor's first run.
      const worker = async () => {
        for (let agent = due.shift(); agent; agent = due.shift()) {
          // Scheduled runs act as the owner, so their connected apps work without them present.
          const run = await runOnce(agent, undefined, agent.owner);
          onRun?.(run);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, due.length) }, worker));
    } finally {
      ticking = false;
    }
  }, 20_000);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
