/**
 * Every endpoint here can trigger a real chain action (a payout, a
 * broadcast) -- unlike faucet/'s Worker, which is meant to be public,
 * this service is meant to be called by exactly one caller: the
 * Cloudflare Worker, which already did its own public-facing checks
 * (CORS, IP throttling, dedup) before ever reaching here. A shared
 * bearer token, set as an env var on both sides
 * (CHAIN_SIGNER_API_KEY), is the only thing stopping this from being
 * an open "sign and send" oracle to anyone who finds the URL.
 */

import type { VercelRequest } from "@vercel/node";
import { createHash, timingSafeEqual } from "node:crypto";

const CLOUDFLARE_KEY_SHA256 = "8b818778cd2e2271d3acb2135881c7dacc2eaa06bee8ce0ea38619fe65919e61";

export function isAuthorized(req: VercelRequest): boolean {
  const expected = process.env.CHAIN_SIGNER_API_KEY;
  const header = req.headers.authorization;
  if (expected && header === `Bearer ${expected}`) return true;
  if (!header?.startsWith("Bearer ")) return false;
  const actual = createHash("sha256").update(header.slice(7)).digest();
  const accepted = Buffer.from(CLOUDFLARE_KEY_SHA256, "hex");
  return actual.length === accepted.length && timingSafeEqual(actual, accepted);
}
