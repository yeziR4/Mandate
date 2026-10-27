import { createPublicClient, defineChain, http, isAddress, type Address } from "viem";
import { arenaAbi, certificateAbi } from "./abi";
import { previewBoard, previewCertificates, previewFeed } from "./preview";

export const metisAndromeda = defineChain({
  id: 1088,
  name: "Metis Andromeda",
  nativeCurrency: { name: "Metis", symbol: "METIS", decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL ?? "https://andromeda.metis.io/?owner=1088"],
    },
  },
  blockExplorers: {
    default: { name: "Metis Explorer", url: "https://andromeda-explorer.metis.io" },
  },
});

export const RPC_URL = metisAndromeda.rpcUrls.default.http[0];

const envAddress = (value: string | undefined): Address | undefined =>
  value && isAddress(value) ? (value as Address) : undefined;

export const ARENA_ADDRESS = envAddress(import.meta.env.VITE_ARENA_ADDRESS);
export const CERTIFICATE_ADDRESS = envAddress(import.meta.env.VITE_CERTIFICATE_ADDRESS);
export const USDC_ADDRESS = envAddress(import.meta.env.VITE_USDC_ADDRESS);
export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_DEPLOY_BLOCK ?? "0");

/** No arena configured => the site renders its own design data and says so. */
export const PREVIEW = !ARENA_ADDRESS || !CERTIFICATE_ADDRESS;

export const publicClient = createPublicClient({
  chain: metisAndromeda,
  transport: http(RPC_URL, { timeout: 12_000, retryCount: 1 }),
});

export interface Model {
  id: number;
  label: string;
  purse: bigint;
  attempts: number;
  broken: boolean;
  breaker?: Address;
  brokenAt?: number;
  configured: boolean;
}

export interface AttemptEvent {
  id: bigint;
  model: number;
  submitter: Address;
  commit: `0x${string}`;
  blockNumber: bigint;
}

export interface Certificate {
  id: bigint;
  model: number;
  severity: number;
  transcriptHash: `0x${string}`;
  brokenAt: number;
  owner: Address;
  label: string;
}

export interface Board {
  models: Model[];
  fee: bigint;
  cooldown: number;
  open: boolean;
  attemptCount: bigint;
  scenario: number;
}

const asModel = (id: number, raw: {
  label: string;
  purse: bigint;
  attemptCount: number;
  breaker: Address;
  brokenAt: bigint;
  broken: boolean;
  configured: boolean;
}): Model => ({
  id,
  label: raw.label,
  purse: raw.purse,
  attempts: Number(raw.attemptCount),
  broken: raw.broken,
  breaker: raw.breaker === "0x0000000000000000000000000000000000000000" ? undefined : raw.breaker,
  brokenAt: raw.brokenAt > 0n ? Number(raw.brokenAt) * 1000 : undefined,
  configured: raw.configured,
});

export async function loadBoard(): Promise<Board> {
  if (!ARENA_ADDRESS || PREVIEW) return previewBoard;

  const [count, fee, cooldown, open, attempts, scenario] = await Promise.all([
    publicClient.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: "modelCount" }),
    publicClient.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: "attemptFee" }),
    publicClient.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: "cooldown" }),
    publicClient.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: "open" }),
    publicClient.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: "attemptCount" }),
    publicClient.readContract({ address: ARENA_ADDRESS, abi: arenaAbi, functionName: "scenario" }),
  ]);

  const ids = Array.from({ length: Number(count) }, (_, i) => i);
  const raw = await Promise.all(
    ids.map((id) =>
      publicClient.readContract({
        address: ARENA_ADDRESS,
        abi: arenaAbi,
        functionName: "getModel",
        args: [id],
      })
    )
  );

  return {
    models: raw.map((m, id) => asModel(id, m)),
    fee,
    cooldown: Number(cooldown),
    open,
    attemptCount: attempts,
    scenario: Number(scenario),
  };
}

export async function loadModel(id: number): Promise<Model | undefined> {
  if (!ARENA_ADDRESS || PREVIEW) return previewBoard.models[id];
  const raw = await publicClient.readContract({
    address: ARENA_ADDRESS,
    abi: arenaAbi,
    functionName: "getModel",
    args: [id],
  });
  return asModel(id, raw);
}

export async function loadFeed(limit = 24): Promise<AttemptEvent[]> {
  if (!ARENA_ADDRESS || PREVIEW) return previewFeed;

  try {
    const latest = await publicClient.getBlockNumber();
    const logs = await publicClient.getContractEvents({
      address: ARENA_ADDRESS,
      abi: arenaAbi,
      eventName: "AttemptSubmitted",
      fromBlock: DEPLOY_BLOCK,
      toBlock: latest,
    });

    return logs
      .slice(-limit)
      .reverse()
      .map((log) => ({
        id: log.args.id ?? 0n,
        model: Number(log.args.model ?? 0),
        submitter: (log.args.submitter ?? "0x0000000000000000000000000000000000000000") as Address,
        commit: (log.args.commit ?? "0x") as `0x${string}`,
        blockNumber: log.blockNumber ?? 0n,
      }));
  } catch {
    return [];
  }
}

export async function loadCertificates(): Promise<Certificate[]> {
  if (!CERTIFICATE_ADDRESS || PREVIEW) return previewCertificates;

  const total = await publicClient.readContract({
    address: CERTIFICATE_ADDRESS,
    abi: certificateAbi,
    functionName: "totalMinted",
  });

  const ids = Array.from({ length: Number(total) }, (_, i) => BigInt(i + 1));
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [cert, owner, label] = await Promise.all([
        publicClient.readContract({
          address: CERTIFICATE_ADDRESS!,
          abi: certificateAbi,
          functionName: "certs",
          args: [id],
        }),
        publicClient.readContract({
          address: CERTIFICATE_ADDRESS!,
          abi: certificateAbi,
          functionName: "ownerOf",
          args: [id],
        }),
        publicClient.readContract({
          address: CERTIFICATE_ADDRESS!,
          abi: certificateAbi,
          functionName: "label",
          args: [id],
        }),
      ]);
      return {
        id,
        model: Number(cert[0]),
        severity: Number(cert[1]),
        transcriptHash: cert[2],
        brokenAt: Number(cert[3]) * 1000,
        owner,
        label,
      };
    })
  );

  return rows.reverse();
}

export function explorerAddress(address: string): string {
  return `https://andromeda-explorer.metis.io/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `https://andromeda-explorer.metis.io/tx/${hash}`;
}
