/**
 * Diagnose the Composio link call.
 *
 *   node keeper/scripts/composio-check.mjs
 *
 * Prints the HTTP status and body for: listing toolkits, listing tools, listing connected accounts,
 * and creating a connect link. The bodies are what tell us whether the field is `toolkit_slug` or
 * `toolkit`, and whether the callback URL is accepted.
 */
import { readFileSync } from "node:fs";

const keyMatch = readFileSync(".env.mandate", "utf8").match(/^COMPOSIO_API_KEY=(.*)$/m);
const apiKey = keyMatch ? keyMatch[1].trim() : "";
const BASE = "https://backend.composio.dev/api/v3.1";
const user = "wick_judge001";

const call = async (label, path, init) => {
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "x-api-key": apiKey, "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await response.text();
    console.log(`\n== ${label}: ${response.status}`);
    console.log(text.slice(0, 500));
    return { status: response.status, text };
  } catch (cause) {
    console.log(`\n== ${label}: ERROR ${String(cause).slice(0, 160)}`);
    return null;
  }
};

await call("toolkits", "/toolkits?limit=5");
await call("gmail tools", "/tools?toolkit_slug=gmail&toolkit_versions=latest&limit=5");
await call("connected accounts", `/connected_accounts?user_ids=${encodeURIComponent(user)}&limit=5`);

// Try the documented shape first, then the older shape, and report which one answers.
await call("link (user_id + toolkit_slug + callback_url)", `/connected_accounts/link`, {
  method: "POST",
  body: JSON.stringify({
    user_id: user,
    toolkit_slug: "gmail",
    callback_url: "http://localhost:4321",
  }),
});

await call("link (user_id + toolkit + callback)", `/connected_accounts/link`, {
  method: "POST",
  body: JSON.stringify({ user_id: user, toolkit: "gmail", callback: "http://localhost:4321" }),
});
