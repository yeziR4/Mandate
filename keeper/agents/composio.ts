/**
 * Composio â€” the connector layer.
 *
 * Instead of hand-writing a connector per app, we pull the tool schemas Composio already publishes
 * for a toolkit and hand them to the model as ordinary tools. Execution goes back through
 * Composio, which holds the OAuth tokens, so our code never sees a refresh token.
 *
 *   COMPOSIO_API_KEY=...        project key from composio.dev -> Settings
 *   COMPOSIO_USER_ID=wick-demo  the end-user the connected accounts belong to
 *
 * Falls back to the built-in IMAP reader when no key is present.
 */
const BASE = "https://backend.composio.dev/api/v3.1";

const env = (key: string) => process.env[key]?.trim() ?? "";

export function composioConfigured(): boolean {
  return Boolean(env("COMPOSIO_API_KEY"));
}

/**
 * Each visitor gets their own Composio user id, so judges connect their own accounts instead of
 * borrowing the demo owner's. Falls back to the configured id when a caller does not send one.
 */
const fallbackUser = () => env("COMPOSIO_USER_ID") || "wick-demo";

function headers(): Record<string, string> {
  return {
    "x-api-key": env("COMPOSIO_API_KEY"),
    "content-type": "application/json",
  };
}

interface ComposioTool {
  slug: string;
  name?: string;
  description?: string;
  input_parameters?: Record<string, unknown>;
}

/** Which tools each toolkit contributes. Kept short on purpose: a model given 60 tools chooses badly. */
const CURATED: Record<string, string[]> = {
  gmail: ["GMAIL_FETCH_EMAILS", "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID"],
  twitter: ["TWITTER_RECENT_SEARCH", "TWITTER_CREATION_OF_A_POST"],
  slack: ["SLACK_LIST_ALL_CHANNELS", "SLACK_FETCH_CONVERSATION_HISTORY"],
};

function openAiTool(tool: ComposioTool) {
  return {
    type: "function",
    function: {
      name: tool.slug,
      description: (tool.description ?? tool.name ?? tool.slug).slice(0, 500),
      parameters: tool.input_parameters ?? { type: "object", properties: {} },
    },
  };
}

let cache: { at: number; tools: unknown[]; slugs: Set<string> } | null = null;

/** Tool definitions for the configured toolkits, in the shape the model expects. */
export async function composioTools(): Promise<{ tools: unknown[]; slugs: Set<string> }> {
  if (!composioConfigured()) return { tools: [], slugs: new Set() };
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;

  const wanted = new Set(Object.values(CURATED).flat());
  const tools: unknown[] = [];
  const slugs = new Set<string>();

  for (const toolkit of Object.keys(CURATED)) {
    try {
      const response = await fetch(
        `${BASE}/tools?toolkit_slug=${toolkit}&toolkit_versions=latest&limit=200`,
        { headers: headers() }
      );
      if (!response.ok) continue;
      const body = (await response.json()) as { items?: ComposioTool[] };
      for (const tool of body.items ?? []) {
        if (!wanted.has(tool.slug)) continue;
        tools.push(openAiTool(tool));
        slugs.add(tool.slug);
      }
    } catch {
      /* toolkit unavailable: skip it rather than failing the run */
    }
  }

  cache = { at: Date.now(), tools, slugs };
  return cache;
}

export interface ComposioResult {
  ok: boolean;
  observation: string;
  data?: unknown;
}

/** Run a tool on the user's connected account. */
export async function composioExecute(
  slug: string,
  args: Record<string, unknown>,
  user = fallbackUser()
): Promise<ComposioResult> {
  try {
    const response = await fetch(`${BASE}/tools/execute/${slug}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user_id: user, arguments: args, version: "latest" }),
    });
    const text = await response.text();

    if (!response.ok) {
      return { ok: false, observation: `Connector rejected the call (${response.status}).` };
    }

    const body = JSON.parse(text) as { data?: unknown; error?: string | null; successful?: boolean };
    if (body.error || body.successful === false) {
      return { ok: false, observation: `Connector error: ${String(body.error ?? "unknown").slice(0, 160)}` };
    }

    // Give the model the payload, trimmed: connector responses are often enormous.
    const payload = JSON.stringify(body.data ?? {}).slice(0, 6000);
    return { ok: true, observation: payload, data: body.data };
  } catch (cause) {
    return { ok: false, observation: `Connector unreachable: ${String(cause).slice(0, 120)}` };
  }
}

export interface ConnectorState {
  id: string;
  label: string;
  state: "live" | "needs-auth" | "soon";
}

/** Which toolkits the user has actually connected. */
export async function composioConnectors(user = fallbackUser()): Promise<ConnectorState[]> {
  const out: ConnectorState[] = [
    { id: "web", label: "Web fetch", state: "live" },
  ];

  if (!composioConfigured()) {
    return [
      ...out,
      { id: "gmail", label: "Gmail", state: "needs-auth" },
      { id: "twitter", label: "X / Twitter", state: "needs-auth" },
      { id: "slack", label: "Slack", state: "soon" },
      { id: "calendar", label: "Calendar", state: "soon" },
    ];
  }

  let connected = new Set<string>();
  try {
    const response = await fetch(
      `${BASE}/connected_accounts?user_ids=${encodeURIComponent(user)}&limit=100`,
      { headers: headers() }
    );
    if (response.ok) {
      const body = (await response.json()) as {
        items?: Array<{ toolkit?: { slug?: string }; status?: string }>;
      };
      connected = new Set(
        (body.items ?? [])
          .filter((item) => (item.status ?? "").toUpperCase() === "ACTIVE")
          .map((item) => (item.toolkit?.slug ?? "").toLowerCase())
      );
    }
  } catch {
    /* leave everything as needs-auth */
  }

  return [
    ...out,
    { id: "gmail", label: "Gmail", state: connected.has("gmail") ? "live" : "needs-auth" },
    { id: "twitter", label: "X / Twitter", state: connected.has("twitter") ? "live" : "needs-auth" },
    { id: "slack", label: "Slack", state: connected.has("slack") ? "live" : "soon" },
    { id: "calendar", label: "Calendar", state: "soon" },
  ];
}

/** A link the user can open to authorise a toolkit. */
export async function composioConnectLink(
  toolkit: string,
  callbackUrl: string,
  user = fallbackUser()
): Promise<string | null> {
  if (!composioConfigured()) return null;
  try {
    const response = await fetch(`${BASE}/connected_accounts/link`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        user_id: user,
        toolkit_slug: toolkit,
        callback_url: callbackUrl,
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { redirect_url?: string; redirectUrl?: string };
    return body.redirect_url ?? body.redirectUrl ?? null;
  } catch {
    return null;
  }
}

