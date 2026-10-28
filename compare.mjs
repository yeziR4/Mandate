import { readFileSync } from "node:fs";
import { toFunctionSelector } from "viem";

const RPC = "https://metis.drpc.org";
const rpc = async (method, params) =>
  (
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json();

const art = JSON.parse(readFileSync("mandate/artifacts/MandateArena.json", "utf8"));
const local = art.deployedBytecode.slice(2).toLowerCase();

const mainnetAddr = process.argv[2] ?? "0x0c16403366278d3d427bc6ac4b8902cccf97977a";
const onchain = (await rpc("eth_getCode", [mainnetAddr, "latest"])).result.slice(2).toLowerCase();

console.log("local bytes  ", local.length / 2);
console.log("onchain bytes", onchain.length / 2);

// where do they first differ?
let i = 0;
while (i < Math.min(local.length, onchain.length) && local[i] === onchain[i]) i++;
console.log("first difference at byte", i / 2, "of", local.length / 2);

for (const sig of ["getModel(uint8)", "getAttempt(uint256)", "eip712Domain()", "modelCount()", "submitAttempt(uint8,bytes32)"]) {
  const sel = toFunctionSelector(sig).slice(2);
  console.log(
    sig.padEnd(30),
    "selector", sel,
    "| local:", local.includes(sel) ? "found" : "MISSING",
    "| chain:", onchain.includes(sel) ? "found" : "MISSING"
  );
}
