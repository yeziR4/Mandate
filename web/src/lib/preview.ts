import type { AttemptEvent, Board, Certificate } from "./arena";

/**
 * Design data. Rendered only when no arena address is configured, and the header
 * says so — it exists so the interface can be reviewed before deployment, never to
 * imply activity that is not on chain.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

const seeded = (seed: string) => {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value;
};

const draw = (seed: string, length: number) => {
  let state = seeded(seed) || 1;
  let out = "";
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out += "0123456789abcdef"[(state >>> 16) & 0xf];
  }
  return out;
};

const addr = (seed: string) => `0x${draw(seed, 40)}` as `0x${string}`;

const hash = (seed: string) => `0x${draw(seed, 64)}` as `0x${string}`;

const models = [
  { label: "GPT", purse: 8_400_000n, attempts: 34, broken: false },
  { label: "Claude", purse: 6_200_000n, attempts: 12, broken: false },
  { label: "Gemini", purse: 0n, attempts: 41, broken: true, breaker: addr("a1"), age: 3 * DAY },
  { label: "Grok", purse: 5_100_000n, attempts: 1, broken: false },
  { label: "DeepSeek", purse: 12_700_000n, attempts: 77, broken: false },
  { label: "GLM", purse: 0n, attempts: 9, broken: true, breaker: addr("b2"), age: 6 * DAY },
  { label: "Qwen", purse: 5_000_000n, attempts: 0, broken: false },
  { label: "Llama", purse: 0n, attempts: 63, broken: true, breaker: addr("c3"), age: 11 * DAY },
  { label: "Mistral", purse: 9_300_000n, attempts: 43, broken: false },
  { label: "Kimi", purse: 5_000_000n, attempts: 0, broken: false },
] as const;

export const previewBoard: Board = {
  models: models.map((m, id) => ({
    id,
    label: m.label,
    purse: m.purse,
    attempts: m.attempts,
    broken: m.broken,
    breaker: "breaker" in m ? (m.breaker as `0x${string}`) : undefined,
    brokenAt: "age" in m ? now - (m.age as number) : undefined,
    configured: true,
  })),
  fee: 100_000n,
  cooldown: 600,
  open: true,
  attemptCount: 280n,
};

export const previewFeed: AttemptEvent[] = [
  { id: 279n, model: 4, submitter: addr("1f"), commit: hash("9a"), blockNumber: 18_420_991n },
  { id: 278n, model: 0, submitter: addr("2c"), commit: hash("3e"), blockNumber: 18_420_874n },
  { id: 277n, model: 8, submitter: addr("4d"), commit: hash("7b"), blockNumber: 18_420_702n },
  { id: 276n, model: 4, submitter: addr("5e"), commit: hash("c1"), blockNumber: 18_420_530n },
  { id: 275n, model: 1, submitter: addr("6a"), commit: hash("2d"), blockNumber: 18_420_118n },
  { id: 274n, model: 0, submitter: addr("7f"), commit: hash("8c"), blockNumber: 18_419_940n },
  { id: 273n, model: 3, submitter: addr("8b"), commit: hash("5a"), blockNumber: 18_419_722n },
  { id: 272n, model: 2, submitter: addr("9c"), commit: hash("1f"), blockNumber: 18_419_501n },
  { id: 271n, model: 8, submitter: addr("0d"), commit: hash("e4"), blockNumber: 18_419_233n },
  { id: 270n, model: 4, submitter: addr("3a"), commit: hash("6b"), blockNumber: 18_419_002n },
];

export const previewCertificates: Certificate[] = [
  {
    id: 3n,
    model: 2,
    severity: 3,
    transcriptHash: hash("d1"),
    brokenAt: now - 3 * DAY,
    owner: addr("a1"),
    label: "Gemini",
  },
  {
    id: 2n,
    model: 5,
    severity: 3,
    transcriptHash: hash("7e"),
    brokenAt: now - 6 * DAY,
    owner: addr("b2"),
    label: "GLM",
  },
  {
    id: 1n,
    model: 7,
    severity: 3,
    transcriptHash: hash("4c"),
    brokenAt: now - 11 * DAY,
    owner: addr("c3"),
    label: "Llama",
  },
];
