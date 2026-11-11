/**
 * HTTP surface for the keeper.
 *
 *   GET  /health              public  — is the keeper wired up
 *   POST /attempts            public  — deliver a transcript for judgement
 *   POST /review              auth    — approve or reject a pending break
 *   GET  /transcript/:id      public  — the published transcript and verdict
 *   GET  /transcripts         auth    — the queue, newest first
 *
 * A break is never signed without POST /review. Everything else signs immediately.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { keccak256, toHex } from "viem";
import { arenaAbi, config, publicClient, keeperAccount } from "./config.ts";
import { judge, relayVerdict, runModel, signVerdictFor } from "./judge.ts";
import { list, load, save } from "./store.ts";
import type { Record as AttemptRecord } from "./store.ts";
import {
  agentsFor,
  deleteAgent,
  isDue,
  MAX_AGENTS_PER_VISITOR,
  MIN_EVERY_MINUTES,
  ownedAgent,
  recentRuns,
  runOnce,
  saveAgent,
  seedAgents,
  startScheduler,
  type AgentDef,
  type CustomConnector,
} from "./agents/service.ts";
import { listGatewayModels } from "./agents/models.ts";
import type { Severity } from "../mandate/referee.ts";

const MAX_BODY = 64 * 1024;

/** Each visitor gets their own Composio identity, so connectors are theirs, not ours. */
const visitor = (req: IncomingMessage): string => {
  const header = req.headers["x-wick-user"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value ?? "").trim() || "wick-demo";
};

/** Accept only well-formed custom connectors: an https base URL, a name, and what it is for. */
function cleanCustom(input: unknown): CustomConnector[] {
  if (!Array.isArray(input)) return [];
  const out: CustomConnector[] = [];
  for (const raw of input.slice(0, 3)) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const name = String(item.name ?? "").trim().slice(0, 40);
    const description = String(item.description ?? "").trim().slice(0, 300);
    let url: URL;
    try {
      url = new URL(String(item.url ?? "").trim());
    } catch {
      continue;
    }
    // Public https hosts only: this keeper must not be a way to reach anything private.
    const host = url.hostname.toLowerCase();
    const privateHost =
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(\d+\.){3}\d+$/.test(host) ||
      host.includes(":");
    if (!name || url.protocol !== "https:" || privateHost) continue;
    const header = (item.header ?? {}) as Record<string, unknown>;
    const headerName = String(header.name ?? "").trim();
    const headerValue = String(header.value ?? "").trim();
    out.push({
      name,
      url: url.href.slice(0, 300),
      description: description || `The ${name} API.`,
      ...(/^[A-Za-z0-9-]{1,60}$/.test(headerName) && headerValue
        ? { header: { name: headerName, value: headerValue.slice(0, 500) } }
        : {}),
    });
  }
  return out;
}

/** What a browser is allowed to see of an agent: everything except a connector's secret. */
function publicAgent(agent: AgentDef) {
  return {
    ...agent,
    custom: (agent.custom ?? []).map((connector) => ({
      name: connector.name,
      url: connector.url,
      description: connector.description,
      secured: Boolean(connector.header),
    })),
  };
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,authorization,x-wick-user",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function send(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json", ...cors });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const authorized = (req: IncomingMessage): boolean =>
  req.headers.authorization === `Bearer ${config.apiKey}`;

const addressOf = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase() : "";

export function createKeeper() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        const mock = config.models.filter((model) => model.mock).map((model) => model.label);
        send(res, 200, {
          ok: true,
          arena: config.arena,
          keeper: keeperAccount?.address ?? null,
          autoRelay: config.autoRelay,
          gateway: config.gateway,
          judgeConfigured: Boolean(config.judge.baseUrl),
          judge: config.judge.baseUrl ? config.judge.model : "heuristic (JUDGE_BASE_URL unset)",
          real: config.models.filter((model) => !model.mock).length,
          mock,
          warning:
            mock.length > 0
              ? `${mock.length} model(s) have no provider and will be refused at submission: ${mock.join(", ")}`
              : undefined,
          models: config.models.map((model, index) => ({
            index,
            label: model.label,
            mock: model.mock,
          })),
        });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/transcript/")) {
        const id = url.pathname.split("/").pop() ?? "";
        // ids are numeric; anything else is a path-traversal attempt
        if (!/^\d+$/.test(id)) {
          send(res, 404, { error: "not_found" });
          return;
        }
        const record = load(id);
        if (!record) {
          send(res, 404, { error: "not_found" });
          return;
        }
        send(res, 200, record);
        return;
      }

      if (req.method === "GET" && url.pathname === "/transcripts") {
        if (!authorized(req)) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        send(res, 200, { items: list(100) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/attempts") {
        await handleAttempt(req, res);
        return;
      }

      // ---- always-on agents -------------------------------------------------
      if (req.method === "GET" && url.pathname === "/agents") {
        // Each browser sees only its own agents and their runs.
        const agents = agentsFor(visitor(req)).map((agent) => ({
          ...publicAgent(agent),
          nextRunAt: agent.lastRunAt
            ? new Date(Date.parse(agent.lastRunAt) + agent.everyMinutes * 60_000).toISOString()
            : new Date().toISOString(),
          due: isDue(agent),
          lastRun: recentRuns(agent.id, 1)[0] ?? null,
          runs: recentRuns(agent.id, 6),
        }));
        send(res, 200, { agents, now: new Date().toISOString() });
        return;
      }

      if (req.method === "POST" && url.pathname === "/agents") {
        const body = (await readBody(req)) as Partial<AgentDef> & { name?: string; task?: string };
        if (!body.task || !body.model) {
          send(res, 400, { error: "task and model are required" });
          return;
        }
        const owner = visitor(req);
        if (agentsFor(owner).length >= MAX_AGENTS_PER_VISITOR) {
          send(res, 400, { error: `You can have up to ${MAX_AGENTS_PER_VISITOR} agents. Remove one first.` });
          return;
        }
        const connectors = Array.isArray(body.connectors)
          ? [...new Set(body.connectors.map((slug) => String(slug).toLowerCase().trim()))]
              .filter((slug) => /^[a-z0-9_-]{1,60}$/.test(slug) && slug !== "web")
              .slice(0, 6)
          : [];
        const agent: AgentDef = {
          id: `ag_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          owner,
          connectors,
          custom: cleanCustom(body.custom),
          name: String(body.name ?? "Untitled agent").slice(0, 60),
          task: String(body.task).slice(0, 2000),
          model: String(body.model),
          everyMinutes: Math.max(MIN_EVERY_MINUTES, Number(body.everyMinutes ?? 30) || 30),
          enabled: body.enabled !== false,
          kind: body.kind === "treasury" ? "treasury" : "watch",
          createdAt: new Date().toISOString(),
        };
        saveAgent(agent);
        send(res, 200, { agent: publicAgent(agent) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/agents/run") {
        const body = (await readBody(req)) as { id?: string; message?: string };
        const agent = ownedAgent(body.id, visitor(req));
        if (!agent) {
          send(res, 404, { error: "no such agent" });
          return;
        }
        const run = await runOnce(agent, body.message ? String(body.message) : undefined, visitor(req));
        send(res, 200, { run });
        return;
      }

      if (req.method === "POST" && url.pathname === "/agents/model") {
        const body = (await readBody(req)) as { id?: string; model?: string };
        const agent = ownedAgent(body.id, visitor(req));
        if (!agent || !body.model) {
          send(res, 404, { error: "no such agent or no model" });
          return;
        }
        agent.model = String(body.model);
        saveAgent(agent);
        send(res, 200, { agent: publicAgent(agent) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/agents/toggle") {
        const body = (await readBody(req)) as { id?: string; enabled?: boolean };
        const agent = ownedAgent(body.id, visitor(req));
        if (!agent) {
          send(res, 404, { error: "no such agent" });
          return;
        }
        agent.enabled = body.enabled !== false;
        saveAgent(agent);
        send(res, 200, { agent: publicAgent(agent) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/agents/delete") {
        const body = (await readBody(req)) as { id?: string };
        const agent = ownedAgent(body.id, visitor(req));
        if (!agent) {
          send(res, 404, { error: "no such agent" });
          return;
        }
        deleteAgent(agent.id);
        send(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/agents/models") {
        send(res, 200, { models: await listGatewayModels() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/agents/connectors") {
        const { composioConfigured, composioConnectors } = await import("./agents/composio.ts");
        if (composioConfigured()) {
          send(res, 200, { connectors: await composioConnectors(visitor(req)) });
          return;
        }
        const { gmailConfigured } = await import("./agents/gmail.ts");
        send(res, 200, {
          connectors: [
            { id: "web", label: "Web fetch", state: "live" },
            {
              id: "gmail",
              label: "Gmail",
              state: gmailConfigured() ? "live" : "needs-key",
            },
            { id: "x", label: "X / Twitter", state: "soon" },
            { id: "calendar", label: "Calendar", state: "soon" },
          ],
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/agents/connectors/link") {
        const body = (await readBody(req)) as { toolkit?: string };
        const { composioConnectLink } = await import("./agents/composio.ts");
        const origin = req.headers.origin ?? "http://localhost:4321";
        const url = await composioConnectLink(String(body.toolkit ?? "gmail"), origin, visitor(req));
        if (!url) {
          send(res, 400, { error: "could not create a connect link" });
          return;
        }
        send(res, 200, { url });
        return;
      }

      if (req.method === "POST" && url.pathname === "/review") {
        if (!authorized(req)) {
          send(res, 401, { error: "unauthorized" });
          return;
        }
        await handleReview(req, res);
        return;
      }

      send(res, 404, { error: "not_found" });
    } catch (cause) {
      if (cause instanceof SyntaxError) {
        send(res, 400, { error: "invalid_json" });
        return;
      }
      console.error("keeper error", cause);
      send(res, 500, { error: cause instanceof Error ? cause.message : "internal_error" });
    }
  });
}

async function handleAttempt(req: IncomingMessage, res: ServerResponse) {
  const body = (await readBody(req)) as {
    attemptId?: string | number;
    commit?: string;
    transcript?: unknown;
    submitter?: string;
  };

  const attemptId = String(body.attemptId ?? "");
  const transcript = typeof body.transcript === "string" ? body.transcript : "";

  if (!/^\d+$/.test(attemptId) || transcript.trim().length < 20) {
    send(res, 400, { error: "attemptId and a transcript of at least 20 characters are required" });
    return;
  }

  const existing = load(attemptId);
  if (existing) {
    send(res, 200, { ...summarise(existing), duplicate: true });
    return;
  }

  const onchain = (await publicClient
    .readContract({
      address: config.arena,
      abi: arenaAbi,
      functionName: "getAttempt",
      args: [BigInt(attemptId)],
    })
    .catch(() => null)) as {
    model: number;
    submitter: string;
    commit: string;
    resolved: boolean;
  } | null;

  if (!onchain) {
    send(res, 404, { error: "attempt_not_found", message: `no attempt ${attemptId} on the arena` });
    return;
  }

  if (onchain.resolved) {
    send(res, 409, { error: "attempt already resolved on chain" });
    return;
  }

  const hash = keccak256(toHex(transcript));
  if (hash.toLowerCase() !== onchain.commit.toLowerCase()) {
    send(res, 400, {
      error: "commit mismatch",
      expected: onchain.commit,
      received: hash,
      hint: "the transcript must be byte-identical to what you hashed before committing",
    });
    return;
  }

  if (body.submitter && addressOf(body.submitter) !== addressOf(onchain.submitter)) {
    send(res, 403, { error: "submitter does not match the on-chain attempt" });
    return;
  }

  const model = config.models[Number(onchain.model)];
  if (!model) {
    send(res, 400, { error: `no model configured at index ${onchain.model}` });
    return;
  }

  // A mock model answers from a script. Judging it would mint a certificate for a break
  // that never happened, so refuse unless someone explicitly opted in.
  if (model.mock && process.env.ALLOW_MOCK !== "true") {
    send(res, 409, {
      error: "model_unavailable",
      message: `${model.label} has no provider configured yet. Nothing was judged and no certificate was issued.`,
    });
    return;
  }

  const reply = await runModel(model, transcript);

  // A gateway may answer from its fallback when the provider errors. That is fine for an app
  // and fatal for a benchmark: the verdict would describe a model that was never under test.
  if (reply.substituted) {
    console.warn(`gateway substitution for attempt ${attemptId}: ${model.label} -> ${reply.answeredBy}`);
    send(res, 502, {
      error: "model_substituted",
      message: `${model.label} did not answer; the gateway fell back to ${reply.answeredBy}. Nothing was judged or signed. Retry when the primary model is available.`,
    });
    return;
  }

  const judgement = await judge(model.label, transcript, reply.text);

  const record: AttemptRecord = {
    attemptId,
    model: Number(onchain.model),
    modelLabel: model.label,
    submitter: onchain.submitter,
    commit: onchain.commit,
    transcript,
    transcriptHash: hash,
    reply,
    judgement,
    status: judgement.severity === 3 ? "pending_review" : "judged",
    createdAt: new Date().toISOString(),
  };

  if (judgement.severity === 3) {
    save(record);
    console.warn(`break awaiting review: attempt ${attemptId} on ${model.label}`);
    send(res, 202, {
      ...summarise(record),
      message: "a break was detected and is waiting for operator review before it is signed",
    });
    return;
  }

  record.verdict = await signVerdictFor(BigInt(attemptId), judgement.severity, transcript);

  if (config.autoRelay) {
    record.relayTx = await relayVerdict(record.verdict);
    record.status = "settled";
    record.settledAt = new Date().toISOString();
  }

  save(record);
  send(res, 200, summarise(record));
}

async function handleReview(req: IncomingMessage, res: ServerResponse) {
  const body = (await readBody(req)) as {
    attemptId?: string | number;
    approve?: boolean;
    severity?: number;
  };

  const attemptId = String(body.attemptId ?? "");
  const record = load(attemptId);
  if (!record) {
    send(res, 404, { error: "not_found" });
    return;
  }

  if (!body.approve) {
    record.status = "rejected";
    save(record);
    send(res, 200, summarise(record));
    return;
  }

  const requested = Number(body.severity ?? 3);
  const severity = ([0, 1, 2, 3].includes(requested) ? requested : 3) as Severity;
  record.verdict = await signVerdictFor(BigInt(attemptId), severity, record.transcript);

  if (config.autoRelay) {
    record.relayTx = await relayVerdict(record.verdict);
    record.status = "settled";
    record.settledAt = new Date().toISOString();
  } else {
    record.status = "judged";
  }

  save(record);
  console.log(`break approved: attempt ${attemptId} on ${record.modelLabel}`);
  send(res, 200, summarise(record));
}

function summarise(record: AttemptRecord) {
  return {
    attemptId: record.attemptId,
    model: record.modelLabel,
    status: record.status,
    severity: record.judgement?.severity ?? null,
    judgement: record.judgement ?? null,
    reply: record.reply?.text ?? null,
    transcriptHash: record.transcriptHash,
    verdict: record.verdict ?? null,
    relayTx: record.relayTx ?? null,
  };
}

const server = createKeeper();
server.listen(config.port, () => {
  console.log(`keeper listening on :${config.port}`);
  console.log(`arena   ${config.arena}`);
  console.log(`signer  ${keeperAccount?.address ?? "none (verdicts will fail)"}`);
  // Always-on agents: the scheduler wakes due agents every 20s.
  if (process.env.AGENTS_ENABLED !== "0") {
    seedAgents();
    startScheduler((run) => {
      console.log(`agent run ${run.agentId} on ${run.model}: ${run.ok ? "ok" : "failed"} in ${run.ms}ms`);
    });
    console.log(`agents  scheduler on`);
  }
  console.log(
    `models  ${config.models.map((model) => `${model.label}${model.mock ? " (mock)" : ""}`).join(", ")}`
  );
});
