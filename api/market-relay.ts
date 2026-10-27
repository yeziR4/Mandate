/**
 * Verifies and broadcasts a client-signed market stake, now that
 * GearApi.create() has been confirmed unable to initialize inside a
 * Cloudflare Workers isolate -- see docs/architecture.md. This
 * endpoint is stateless and non-custodial, same as the MarketLedger
 * logic it replaced: it never holds anyone's key, it only decodes an
 * already-signed extrinsic, checks it's really a transfer to the
 * given pool address, and relays it. Dedup-by-txHash and the running
 * yes/no totals stay in faucet/'s MarketLedger Durable Object, which
 * calls this endpoint and then records the result itself.
 *
 * Auth: requires `Authorization: Bearer <CHAIN_SIGNER_API_KEY>` --
 * this is not a public endpoint, even though it's non-custodial,
 * mainly to stop it being used as a free arbitrary-broadcast relay by
 * anyone who finds the URL. See lib/auth.ts.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GearApi, decodeAddress } from "@gear-js/api";
import { isAuthorized } from "../lib/auth.js";
import { TimeoutError, withTimeout } from "../lib/withTimeout.js";

const VARA_MAINNET_ENDPOINT = "wss://rpc.vara.network";
const CONNECT_TIMEOUT_MS = 20_000;
const BROADCAST_TIMEOUT_MS = 30_000;

// A real signed balances.transferKeepAlive extrinsic is comfortably
// larger than this -- a cheap gate against garbage input before it
// ever reaches GearApi, same reasoning as MarketLedger.ts's own
// pre-check (kept there too, so a request never even leaves the
// Worker for something this obviously invalid).
const MIN_EXTRINSIC_HEX_LENGTH = 200;

interface MarketRelayBody {
  signedExtrinsicHex?: unknown;
  poolAddress?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const body = req.body as MarketRelayBody;
  const { signedExtrinsicHex, poolAddress } = body;
  if (
    typeof signedExtrinsicHex !== "string" ||
    !signedExtrinsicHex.startsWith("0x") ||
    signedExtrinsicHex.length < MIN_EXTRINSIC_HEX_LENGTH
  ) {
    res.status(400).json({ error: "invalid_extrinsic" });
    return;
  }
  if (typeof poolAddress !== "string") {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  let api: Awaited<ReturnType<typeof GearApi.create>> | undefined;
  try {
    api = await withTimeout(GearApi.create({ providerAddress: VARA_MAINNET_ENDPOINT }), CONNECT_TIMEOUT_MS);

    let extrinsic;
    try {
      extrinsic = api.tx(signedExtrinsicHex);
    } catch {
      res.status(400).json({ error: "invalid_extrinsic" });
      return;
    }

    if (!extrinsic.isSigned) {
      res.status(400).json({ error: "not_signed" });
      return;
    }
    const { method, section, args } = extrinsic.method;
    if (section !== "balances" || !method.startsWith("transfer")) {
      res.status(400).json({ error: "not_a_transfer" });
      return;
    }

    const [dest, amount] = args;
    let destCanonical: string;
    let poolCanonical: string;
    try {
      destCanonical = decodeAddress(dest.toString());
      poolCanonical = decodeAddress(poolAddress);
    } catch {
      res.status(400).json({ error: "invalid_extrinsic" });
      return;
    }
    if (destCanonical !== poolCanonical) {
      res.status(400).json({ error: "wrong_destination" });
      return;
    }

    const amountPlanck = BigInt(amount.toString());
    if (amountPlanck <= 0n) {
      res.status(400).json({ error: "invalid_amount" });
      return;
    }

    const txHash = extrinsic.hash.toString();
    const stakerAddress = decodeAddress(extrinsic.signer.toString());

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        extrinsic!
          .send((result) => {
            if (result.status.isInBlock) {
              resolve();
            }
            if (result.dispatchError) {
              reject(new Error(result.dispatchError.toString()));
            }
          })
          .catch(reject);
      }),
      BROADCAST_TIMEOUT_MS,
    );

    res.status(200).json({
      status: "relayed",
      txHash,
      address: stakerAddress,
      amountPlanck: amountPlanck.toString(),
    });
  } catch (error) {
    const isTimeout = error instanceof TimeoutError;
    console.error("Market relay failed", error);
    res.status(isTimeout ? 504 : 502).json({ error: isTimeout ? "timeout" : "send_failed" });
  } finally {
    await withTimeout(Promise.resolve(api?.disconnect()), 3_000).catch(() => {});
  }
}
