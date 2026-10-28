import { readFileSync } from "node:fs";
import { encodeFunctionData, decodeFunctionResult } from "viem";

const RPC = "https://metis.drpc.org";
const arena = "0x0c16403366278d3d427bc6ac4b8902cccf97977a";
const abi = JSON.parse(readFileSync("mandate/artifacts/MandateArena.json", "utf8")).abi;

const rpc = async (method, params) =>
  (
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json();

async function probe(label, fn, args = []) {
  const data = encodeFunctionData({ abi, functionName: fn, args });
  const r = await rpc("eth_call", [{ to: arena, data }, "latest"]);
  if (r.error) {
    console.log(label.padEnd(22), "REVERT", r.error.data ?? "");
    return;
  }
  const bytes = (r.result.length - 2) / 2;
  console.log(label.padEnd(22), "OK", `${bytes} bytes`, r.result.slice(0, 74) + "…");
}

await probe("modelCount()", "modelCount");
await probe("scenario()", "scenario");
await probe("bounty()", "bounty");
await probe("eip712Domain()", "eip712Domain");
await probe("getModel(0)", "getModel", [0]);
await probe("getAttempt(0)", "getAttempt", [0n]);
await probe("resolveDigest(0..)", "resolveDigest", [0n, false, 0, "0x" + "00".repeat(32), 0n]);
