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

/** How many tools an uncurated toolkit contributes. Same reason as CURATED: fewer is better. */
const UNCURATED_LIMIT = 8;

const toolkitTools = new Map<string, { at: number; tools: ComposioTool[] }>();

async function fetchTools(params: string): Promise<ComposioTool[]> {
  try {
    const response = await fetch(`${BASE}/tools?${params}&toolkit_versions=latest`, { headers: headers() });
    if (!response.ok) return [];
    return ((await response.json()) as { items?: ComposioTool[] }).items ?? [];
  } catch {
    return []; // toolkit unavailable: skip it rather than failing the run
  }
}

/**
 * The tools one toolkit gives an agent. A curated toolkit gives its curated set. Anything else can
 * have hundreds of tools (GitHub has 883), so we ask Composio for the ones that match the job, and
 * fall back to the toolkit's featured tools when the job text matches nothing.
 */
async function toolsOf(toolkit: string, job: string): Promise<ComposioTool[]> {
  const curated = CURATED[toolkit];
  const key = curated ? toolkit : `${toolkit}\n${job}`;
  const cached = toolkitTools.get(key);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.tools;

  const slug = encodeURIComponent(toolkit);
  let picked: ComposioTool[];
  if (curated) {
    picked = (await fetchTools(`toolkit_slug=${slug}&limit=200`)).filter((tool) => curated.includes(tool.slug));
  } else {
    picked = job
      ? await fetchTools(`toolkit_slug=${slug}&query=${encodeURIComponent(job.slice(0, 200))}&limit=${UNCURATED_LIMIT}`)
      : [];
    if (picked.length === 0) picked = await fetchTools(`toolkit_slug=${slug}&important=true&limit=${UNCURATED_LIMIT}`);
    if (picked.length === 0) picked = await fetchTools(`toolkit_slug=${slug}&limit=${UNCURATED_LIMIT}`);
    picked = picked.slice(0, UNCURATED_LIMIT);
  }

  if (toolkitTools.size > 500) toolkitTools.clear();
  toolkitTools.set(key, { at: Date.now(), tools: picked });
  return picked;
}

/**
 * Tool definitions in the shape the model expects, for the toolkits one agent may use.
 * With no list (records from before agents chose their apps) it is every curated toolkit.
 */
export async function composioTools(
  toolkits?: string[],
  job = ""
): Promise<{ tools: unknown[]; slugs: Set<string> }> {
  if (!composioConfigured()) return { tools: [], slugs: new Set() };

  const tools: unknown[] = [];
  const slugs = new Set<string>();

  for (const toolkit of toolkits ?? Object.keys(CURATED)) {
    for (const tool of await toolsOf(toolkit.toLowerCase(), job)) {
      if (slugs.has(tool.slug)) continue;
      tools.push(openAiTool(tool));
      slugs.add(tool.slug);
    }
  }

  return { tools, slugs };
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
  state: "live" | "needs-auth" | "needs-app";
  logo?: string;
  /** True when Composio can run the OAuth for us, i.e. no developer app needed. */
  managed?: boolean;
  tools?: number;
}

interface Toolkit {
  slug: string;
  name: string;
  logo?: string;
  managed: boolean;
  tools: number;
}

let toolkitCache: { at: number; list: Toolkit[] } | null = null;

/** The whole Composio catalogue, paged. Cached for ten minutes; it is a lot of rows. */
async function listToolkits(): Promise<Toolkit[]> {
  if (toolkitCache && Date.now() - toolkitCache.at < 10 * 60_000) return toolkitCache.list;

  const list: Toolkit[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 12; page++) {
    const url = `${BASE}/toolkits?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    try {
      const response = await fetch(url, { headers: headers() });
      if (!response.ok) break;
      const body = (await response.json()) as {
        items?: Array<{
          slug?: string;
          name?: string;
          meta?: { logo?: string; tools_count?: number };
          composio_managed_auth_schemes?: string[];
        }>;
        next_cursor?: string | null;
      };
      for (const item of body.items ?? []) {
        if (!item.slug) continue;
        list.push({
          slug: item.slug,
          name: item.name ?? item.slug,
          logo: item.meta?.logo,
          managed: (item.composio_managed_auth_schemes ?? []).length > 0,
          tools: item.meta?.tools_count ?? 0,
        });
      }
      cursor = body.next_cursor ?? null;
      if (!cursor) break;
    } catch {
      break;
    }
  }

  toolkitCache = { at: Date.now(), list };
  return list;
}

/** Which toolkits this visitor has actually connected. */
async function connectedToolkits(user: string): Promise<Set<string>> {
  const connected = new Set<string>();
  try {
    const response = await fetch(
      `${BASE}/connected_accounts?user_ids=${encodeURIComponent(user)}&limit=200`,
      { headers: headers() }
    );
    if (response.ok) {
      const body = (await response.json()) as {
        items?: Array<{ toolkit?: { slug?: string }; status?: string }>;
      };
      for (const item of body.items ?? []) {
        if ((item.status ?? "").toUpperCase() !== "ACTIVE") continue;
        connected.add((item.toolkit?.slug ?? "").toLowerCase());
      }
    }
  } catch {
    /* nothing connected */
  }
  return connected;
}

/**
 * The full catalogue, ordered so the useful rows are first: connected, then connectable with
 * Composio-managed OAuth, then everything else.
 */
export async function composioConnectors(user = fallbackUser()): Promise<ConnectorState[]> {
  if (!composioConfigured()) {
    return [
      { id: "web", label: "Web fetch", state: "live", managed: true },
      { id: "gmail", label: "Gmail", state: "needs-auth", managed: true },
      { id: "twitter", label: "X / Twitter", state: "needs-app", managed: false },
    ];
  }

  const [toolkits, connected] = await Promise.all([listToolkits(), connectedToolkits(user)]);

  const rows: ConnectorState[] = toolkits.map((toolkit) => ({
    id: toolkit.slug,
    label: toolkit.name,
    logo: toolkit.logo,
    managed: toolkit.managed,
    tools: toolkit.tools,
    state: connected.has(toolkit.slug)
      ? "live"
      : toolkit.managed
        ? "needs-auth"
        : "needs-app",
  }));

  const rank = (row: ConnectorState) =>
    row.state === "live" ? 0 : row.state === "needs-auth" ? 1 : 2;

  rows.sort((a, b) => rank(a) - rank(b) || (b.tools ?? 0) - (a.tools ?? 0));

  return [{ id: "web", label: "Web fetch", state: "live", managed: true }, ...rows];
}

/** Find (and cache) the auth config for a toolkit. Composio-managed OAuth needs no client secret. */
const authConfigCache = new Map<string, string>();

export async function authConfigFor(toolkit: string): Promise<string | null> {
  const cached = authConfigCache.get(toolkit);
  if (cached) return cached;

  const override = env(`COMPOSIO_${toolkit.toUpperCase()}_AUTH_CONFIG`);
  if (override) {
    authConfigCache.set(toolkit, override);
    return override;
  }

  try {
    const response = await fetch(`${BASE}/auth_configs?toolkit_slug=${toolkit}&limit=1`, {
      headers: headers(),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: Array<{ id?: string }> };
    let id = body.items?.[0]?.id ?? null;

    // First time anyone connects this app: make a Composio-managed auth config for it. This only
    // succeeds for apps Composio can run the OAuth for; the rest need a developer app of our own.
    if (!id) {
      const created = await fetch(`${BASE}/auth_configs`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          toolkit: { slug: toolkit },
          auth_config: { type: "use_composio_managed_auth", credentials: {}, restrict_to_following_tools: [] },
        }),
      });
      if (created.ok) {
        id = ((await created.json()) as { auth_config?: { id?: string } }).auth_config?.id ?? null;
      }
    }

    if (id) authConfigCache.set(toolkit, id);
    return id;
  } catch {
    return null;
  }
}

/** A link the user can open to authorise a toolkit. */
export async function composioConnectLink(
  toolkit: string,
  callbackUrl: string,
  user = fallbackUser()
): Promise<string | null> {
  if (!composioConfigured()) return null;

  const authConfigId = await authConfigFor(toolkit);
  if (!authConfigId) return null;

  try {
    const response = await fetch(`${BASE}/connected_accounts/link`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        user_id: user,
        auth_config_id: authConfigId,
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

