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
import type { Severity } from "../mandate/referee.ts";

const MAX_BODY = 64 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,authorization",
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
  console.log(
    `models  ${config.models.map((model) => `${model.label}${model.mock ? " (mock)" : ""}`).join(", ")}`
  );
});
