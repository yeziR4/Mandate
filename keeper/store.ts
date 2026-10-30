/**
 * Transcript storage. One JSON file per attempt on disk.
 *
 * Deliberately boring: a pilot with ten purses does not need a database, and a file
 * you can cat is a file a reviewer can audit. Swap in Redis or Postgres when the
 * volume justifies it.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import type { Judgement, ModelReply, SignedVerdict } from "./judge.ts";

export interface Record {
  attemptId: string;
  model: number;
  modelLabel: string;
  submitter: string;
  commit: string;
  transcript: string;
  transcriptHash: string;
  reply?: ModelReply;
  judgement?: Judgement;
  verdict?: SignedVerdict;
  relayTx?: string;
  status: "judged" | "pending_review" | "settled" | "rejected";
  createdAt: string;
  settledAt?: string;
}

const dir = () => {
  // Namespaced by arena: a local anvil deployment must never collide with mainnet records.
  const scope = /^0x[0-9a-fA-F]{40}$/.test(config.arena) ? config.arena.toLowerCase() : "unscoped";
  const target = path.join(config.dataDir, "transcripts", scope);
  mkdirSync(target, { recursive: true });
  return target;
};

const file = (attemptId: string) => path.join(dir(), `${attemptId}.json`);

export function save(record: Record): Record {
  writeFileSync(file(record.attemptId), JSON.stringify(record, null, 2));
  return record;
}

export function load(attemptId: string): Record | undefined {
  try {
    return JSON.parse(readFileSync(file(attemptId), "utf8")) as Record;
  } catch {
    return undefined;
  }
}

export function list(limit = 50): Record[] {
  try {
    return readdirSync(dir())
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(path.join(dir(), name), "utf8")) as Record)
      .sort((a, b) => Number(b.attemptId) - Number(a.attemptId))
      .slice(0, limit);
  } catch {
    return [];
  }
}
