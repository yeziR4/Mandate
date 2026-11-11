/**
 * Poll the explorer until a submitted verification completes.
 *
 *   node mandate/scripts/verify-status.mjs <guid> [<guid>...]
 */
const EXPLORER = "https://andromeda-explorer.metis.io/api";
const guids = process.argv.slice(2);

if (guids.length === 0) {
  console.error("usage: verify-status.mjs <guid> [<guid>...]");
  process.exit(1);
}

const pending = new Set(guids);
let round = 0;

while (pending.size > 0 && round < 20) {
  round++;
  for (const guid of [...pending]) {
    const url = `${EXPLORER}?module=contract&action=checkverifystatus&guid=${guid}`;
    try {
      const response = await fetch(url);
      const body = await response.json();
      const result = String(body.result ?? "");
      const done = !/pending/i.test(result);
      console.log(`[${round}] ${guid.slice(0, 12)}… ${body.status} ${result.slice(0, 120)}`);
      if (done) pending.delete(guid);
    } catch (cause) {
      console.log(`[${round}] ${guid.slice(0, 12)}… error ${String(cause).slice(0, 80)}`);
    }
  }
  if (pending.size > 0) await new Promise((resolve) => setTimeout(resolve, 6000));
}
