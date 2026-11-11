/**
 * Build the site against the deployed keeper and ship it.
 *
 *   node keeper/scripts/deploy-web.mjs
 *
 * Exists because the Vercel project builds from the repo root, where package.json belongs to the
 * keeper and has no build script - a dashboard "Redeploy" therefore produces an empty output and
 * 404s production. This always builds first, so what goes live is the working app.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const web = path.join(root, "web");

const KEEPER_URL = process.env.VITE_KEEPER_URL ?? "https://mandate-keeper.fly.dev";

const run = (command, args, cwd) => {
  console.log(`$ ${command} ${args.join(" ")}  (${path.relative(root, cwd)})`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, VITE_KEEPER_URL: KEEPER_URL, CI: "1" },
  });
  if (result.status !== 0) {
    console.error(`failed: ${command}`);
    process.exit(result.status ?? 1);
  }
};

console.log(`keeper: ${KEEPER_URL}\n`);
run("npm", ["run", "build"], web);
run("npx", ["vercel", "deploy", "dist", "--prod", "--yes"], web);
console.log("\ndeployed. open the production alias and check it renders.");
