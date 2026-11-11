/**
 * Auth configs are the missing piece for a connect link.
 *
 * Composio's /connected_accounts/link wants an auth_config_id, not a toolkit slug. For a
 * Composio-managed OAuth app we can create that config ourselves in one call, which is what makes
 * "zero setup" true: no Google Cloud project, no client secret.
 *
 *   node keeper/scripts/composio-authconfig.mjs            # list
 *   node keeper/scripts/composio-authconfig.mjs --create   # create managed configs if missing
 */
import { readFileSync } from "node:fs";

const keyMatch = readFileSync(".env.mandate", "utf8").match(/^COMPOSIO_API_KEY=(.*)$/m);
const apiKey = keyMatch ? keyMatch[1].trim() : "";
const BASE = "https://backend.composio.dev/api/v3.1";
const create = process.argv.includes("--create");

const headers = { "x-api-key": apiKey, "content-type": "application/json" };

async function listConfigs(toolkit) {
  const response = await fetch(`${BASE}/auth_configs?toolkit_slug=${toolkit}&limit=20`, { headers });
  const text = await response.text();
  if (!response.ok) {
    console.log(`${toolkit}: ${response.status} ${text.slice(0, 200)}`);
    return [];
  }
  const body = JSON.parse(text);
  return body.items ?? [];
}

for (const toolkit of ["gmail", "twitter"]) {
  const existing = await listConfigs(toolkit);
  console.log(`\n== ${toolkit}: ${existing.length} auth config(s)`);
  for (const config of existing) {
    console.log(`   ${config.id}  ${config.auth_scheme ?? ""}  ${config.name ?? ""}  ${config.status ?? ""}`);
  }

  if (create && existing.length === 0) {
    const response = await fetch(`${BASE}/auth_configs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        toolkit: { slug: toolkit },
        auth_scheme: "OAUTH2",
        use_composio_managed_auth: true,
      }),
    });
    const text = await response.text();
    console.log(`   create -> ${response.status} ${text.slice(0, 320)}`);
  }
}
