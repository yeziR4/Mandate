/**
 * The one place the faucet wallet's key is ever loaded and used to
 * sign, now that GearApi.create() has been confirmed (for real, via a
 * plain-Node control test against the exact same endpoint) unable to
 * initialize inside a Cloudflare Workers isolate -- see
 * docs/architecture.md for the full story. Everything else about the
 * faucet (dedup by address, the pause flag, IP throttling, CORS)
 * still lives in faucet/'s Cloudflare Worker; this endpoint is called
 * from FaucetLedger.ts only after that dedup check has already passed,
 * and does nothing except the actual chain interaction.
 *
 * Auth: requires `Authorization: Bearer <CHAIN_SIGNER_API_KEY>` --
 * this is not a public endpoint. See lib/auth.ts.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GearApi } from "@gear-js/api";
import { BN } from "@polkadot/util";
import { isAuthorized } from "../lib/auth.js";
import { loadFaucetKeyring } from "../lib/keyring.js";
import { varaToPlanck } from "../lib/units.js";
import { TimeoutError, withTimeout } from "../lib/withTimeout.js";

const VARA_MAINNET_ENDPOINT = "wss://rpc.vara.network";
const CONNECT_TIMEOUT_MS = 20_000;
const BALANCE_TIMEOUT_MS = 10_000;
const BROADCAST_TIMEOUT_MS = 30_000;

interface FaucetPayBody {
  address?: unknown;
  payoutVara?: unknown;
  minReserveVara?: unknown;
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

  const body = req.body as FaucetPayBody;
  const { address, payoutVara, minReserveVara } = body;
  if (typeof address !== "string" || typeof payoutVara !== "string" || typeof minReserveVara !== "string") {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  let api: Awaited<ReturnType<typeof GearApi.create>> | undefined;
  try {
    const faucetKeyring = await loadFaucetKeyring();
    api = await withTimeout(GearApi.create({ providerAddress: VARA_MAINNET_ENDPOINT }), CONNECT_TIMEOUT_MS);

    const payoutPlanck = varaToPlanck(payoutVara);
    const minReservePlanck = varaToPlanck(minReserveVara);

    const faucetBalance = await withTimeout(api.balance.findOut(faucetKeyring.address), BALANCE_TIMEOUT_MS);
    const faucetPlanck = BigInt(faucetBalance.toString());
    if (faucetPlanck - payoutPlanck < minReservePlanck) {
      res.status(503).json({ error: "faucet_low" });
      return;
    }

    const txHash = await withTimeout(
      new Promise<string>((resolve, reject) => {
        api!.balance
          // GearBalance.transfer's declared type is `number | BN`, not
          // bigint -- BN(string) rather than BN(bigint) since BN.js
          // predates native BigInt and its constructor doesn't accept
          // one directly.
          .transfer(address, new BN(payoutPlanck.toString()), true)
          .signAndSend(faucetKeyring, (result) => {
            if (result.status.isInBlock) {
              resolve(result.txHash.toString());
            }
            if (result.dispatchError) {
              reject(new Error(result.dispatchError.toString()));
            }
          })
          .catch(reject);
      }),
      BROADCAST_TIMEOUT_MS,
    );

    res.status(200).json({ status: "sent", txHash, amount: payoutVara });
  } catch (error) {
    const isTimeout = error instanceof TimeoutError;
    console.error("Faucet pay failed", error);
    res.status(isTimeout ? 504 : 502).json({ error: isTimeout ? "timeout" : "send_failed" });
  } finally {
    await withTimeout(Promise.resolve(api?.disconnect()), 3_000).catch(() => {});
  }
}
