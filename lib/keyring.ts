/**
 * Builds the faucet's signing keyring from whichever credential shape
 * is configured -- mirrors faucet/src/FaucetLedger.ts's
 * loadFaucetKeyring() exactly, moved here because this is now where
 * the faucet wallet's key actually lives (see docs/architecture.md
 * for why: GearApi.create() cannot run inside a Cloudflare Worker).
 *
 * FAUCET_MNEMONIC / FAUCET_KEYSTORE_JSON+FAUCET_KEYSTORE_PASSWORD are
 * Vercel environment variables (Project Settings -> Environment
 * Variables, marked sensitive), never committed here, never a GitHub
 * secret -- same discipline as when this lived in Cloudflare.
 */

import { GearKeyring } from "@gear-js/api";

export async function loadFaucetKeyring() {
  const mnemonic = process.env.FAUCET_MNEMONIC;
  if (mnemonic) {
    return GearKeyring.fromMnemonic(mnemonic, "faucet");
  }
  const keystoreJson = process.env.FAUCET_KEYSTORE_JSON;
  const keystorePassword = process.env.FAUCET_KEYSTORE_PASSWORD;
  if (keystoreJson && keystorePassword) {
    return GearKeyring.fromJson(keystoreJson, keystorePassword);
  }
  throw new Error(
    "No faucet credential configured -- set either FAUCET_MNEMONIC, or both " +
      "FAUCET_KEYSTORE_JSON and FAUCET_KEYSTORE_PASSWORD, as Vercel environment variables.",
  );
}
