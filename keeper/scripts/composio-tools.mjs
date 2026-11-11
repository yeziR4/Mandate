import { readFileSync } from "node:fs";

const key = (readFileSync(".env.mandate", "utf8").match(/^COMPOSIO_API_KEY=(.*)$/m) ?? [])[1]?.trim();
const BASE = "https://backend.composio.dev/api/v3.1";
const headers = { "x-api-key": key, "content-type": "application/json" };

const wanted = ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID", "GMAIL_LIST_MESSAGES", "GMAIL_LIST_THREADS"];

for (const toolkit of ["gmail"]) {
  const response = await fetch(`${BASE}/tools?toolkit_slug=${toolkit}&toolkit_versions=latest&limit=200`, { headers });
  const body = await response.json();
  const items = body.items ?? [];
  console.log(`${toolkit}: ${items.length} tools`);

  const matches = items.filter((item) => wanted.includes(item.slug));
  console.log("curated present:", matches.map((m) => m.slug).join(", ") || "NONE");

  const fetchish = items
    .filter((item) => /FETCH|LIST|GET|SEARCH/i.test(item.slug))
    .map((item) => item.slug)
    .slice(0, 12);
  console.log("read-ish slugs:", fetchish.join(", "));
}
