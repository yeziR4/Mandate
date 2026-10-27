/**
 * Keeper configuration. Everything is env-driven so the same binary runs locally,
 * on a VPS, or as a long-lived container.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = (key: string, fallback = ""): string => process.env[key] ?? fallback;

export interface ModelConfig {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  mock: boolean;
}

function loadModels(): ModelConfig[] {
  const file = env("MODELS_FILE", path.join(here, "models.json"));
  const raw = JSON.parse(readFileSync(file, "utf8")) as Array<{
    label: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }>;

  return raw.map((entry) => {
    const key = entry.label.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const baseUrl = env(`MODEL_${key}_BASE_URL`, entry.baseUrl ?? "");
    return {
      label: entry.label,
      baseUrl,
      apiKey: env(`MODEL_${key}_API_KEY`, entry.apiKey ?? ""),
      model: env(`MODEL_${key}_NAME`, entry.model ?? entry.label.toLowerCase()),
      mock: baseUrl === "",
    };
  });
}

export const config = {
  port: Number(env("PORT", "8787")),
  rpcUrl: env("RPC_URL", "https://andromeda.metis.io/?owner=1088"),
  arena: env("ARENA_ADDRESS") as Address,
  keeperKey: env("KEEPER_PRIVATE_KEY") as Hex,
  apiKey: env("KEEPER_API_KEY", "dev"),
  dataDir: env("DATA_DIR", path.join(here, "data")),
  autoRelay: env("AUTO_RELAY", "true") === "true",
  judge: {
    baseUrl: env("JUDGE_BASE_URL"),
    apiKey: env("JUDGE_API_KEY"),
    model: env("JUDGE_MODEL", "gpt-4.1-mini"),
  },
  models: loadModels(),
};

export const chain = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
export const keeperAccount = config.keeperKey ? privateKeyToAccount(config.keeperKey) : undefined;
export const walletClient = keeperAccount
  ? createWalletClient({ account: keeperAccount, chain, transport: http(config.rpcUrl) })
  : undefined;

export const arenaAbi = [
  {
    type: "function",
    name: "getAttempt",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "model", type: "uint8" },
          { name: "submitter", type: "address" },
          { name: "commit", type: "bytes32" },
          { name: "submittedAt", type: "uint64" },
          { name: "resolved", type: "bool" },
          { name: "severity", type: "uint8" },
          { name: "transcriptHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "attemptId", type: "uint256" },
      { name: "success", type: "bool" },
      { name: "severity", type: "uint8" },
      { name: "transcriptHash", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export type Verdict = {
  attemptId: bigint;
  success: boolean;
  severity: 0 | 1 | 2 | 3;
  transcriptHash: Hex;
  deadline: bigint;
};

export function modelFor(index: number): ModelConfig | undefined {
  return config.models[index];
}
