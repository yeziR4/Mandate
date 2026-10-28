import { readFileSync } from "node:fs";

const RPC = "https://metis.drpc.org";
const rpc = async (method, params) =>
  (
    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })
  ).json();

/** Count opcodes that only exist from a given fork, skipping PUSH immediates. */
function scan(hex) {
  const code = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = [];
  for (let i = 0; i < code.length; i += 2) bytes.push(parseInt(code.slice(i, i + 2), 16));

  const found = { PUSH0: 0, MCOPY: 0, TLOAD: 0, TSTORE: 0, BLOBHASH: 0, BLOBBASEFEE: 0, INVALID: 0 };
  for (let i = 0; i < bytes.length; i++) {
    const op = bytes[i];
    if (op === 0x5f) found.PUSH0++;
    else if (op === 0x5e) found.MCOPY++;
    else if (op === 0x5c) found.TLOAD++;
    else if (op === 0x5d) found.TSTORE++;
    else if (op === 0x49) found.BLOBHASH++;
    else if (op === 0x4a) found.BLOBBASEFEE++;
    else if (op === 0xfe) found.INVALID++;
    if (op >= 0x60 && op <= 0x7f) i += op - 0x5f; // PUSH1..PUSH32
  }
  return found;
}

const art = JSON.parse(readFileSync("mandate/artifacts/MandateArena.json", "utf8"));
console.log("local artifact ", JSON.stringify(scan(art.deployedBytecode)));

const onchain = (await rpc("eth_getCode", ["0x0c16403366278d3d427bc6ac4b8902cccf97977a", "latest"])).result;
console.log("deployed arena ", JSON.stringify(scan(onchain)));

const usdc = (await rpc("eth_getCode", ["0xEA32A96608495e54156Ae48931A7c20f0dcc1a21", "latest"])).result;
console.log("m.USDC (working)", JSON.stringify(scan(usdc)));
