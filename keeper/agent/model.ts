/**
 * One model call, streaming, with tool calls.
 *
 * Streaming is not optional: a non-streamed request that takes longer than ~30s is killed by the
 * gateway's edge with an HTML 504 (see keeper/OTARI-ISSUE-2.md). Tool calls arrive as deltas, so
 * the arguments are assembled by index.
 */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ModelReply {
  content: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  promptTokens: number;
  completionTokens: number;
  /** What the gateway says answered. Compared against what we asked for. */
  answeredBy: string | null;
  /** Work the gateway did itself during this call: code it ran, MCP tools it called, pages it read. */
  gatewayCalls: GatewayCall[];
  /** Which provider served the call, and whether a routing policy had to fall back to reach it. */
  servedBy: { provider: string | null; model: string | null; fallback: boolean; attempts: number };
}

/** One server-side tool call, as Otari reports it in `otari_tool_calls`. */
export interface GatewayCall {
  id?: string;
  type: string;
  status?: string;
  name?: string;
  server?: string;
  code?: string;
  stdout?: string;
  query?: string;
  url?: string;
}

/** A refused call, with the gateway's own reason code so callers can say something useful. */
export class GatewayError extends Error {
  code: string | null;
  status: number;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
}

export interface ModelCallOptions {
  baseUrl: string;
  apiKey: string;
  authMode: "otari" | "bearer";
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  maxTokens?: number;
  idleMs?: number;
  temperature?: number;
  /** Extra top-level request fields the gateway understands: mcp_servers, user, guardrails. */
  extra?: Record<string, unknown>;
}

export async function callModel(options: ModelCallOptions): Promise<ModelReply> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const controller = new AbortController();
  const idleMs = options.idleMs ?? 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bump = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleMs);
  };
  bump();

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authMode === "otari") headers["Otari-Key"] = options.apiKey;
  else headers.authorization = `Bearer ${options.apiKey}`;

  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.maxTokens ?? 1600,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  Object.assign(body, options.extra ?? {});

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    if (timer) clearTimeout(timer);
    const detail = (await response.text().catch(() => "")).replace(/<[^>]+>/g, " ").slice(0, 160);
    let code = response.headers.get("otari-error-code");
    if (!code) code = /"(?:code|type)"\s*:\s*"([a-z_]+)"/.exec(detail)?.[1] ?? null;
    throw new GatewayError(`${options.model} returned ${response.status}: ${detail}`, response.status, code);
  }

  const servedBy = {
    provider: response.headers.get("otari-provider"),
    model: response.headers.get("otari-model"),
    fallback: response.headers.get("otari-fallback") === "true",
    attempts: Number(response.headers.get("otari-attempt-count") ?? 1) || 1,
  };
  const gatewayCalls = new Map<string, GatewayCall>();

  let content = "";
  let finishReason: string | undefined;
  let answeredBy: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  const calls = new Map<number, { id: string; name: string; arguments: string }>();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bump();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      let frame: any;
      try {
        frame = JSON.parse(payload);
      } catch {
        continue;
      }
      if (frame.model) answeredBy = frame.model;
      for (const call of (frame.otari_tool_calls ?? []) as GatewayCall[]) {
        gatewayCalls.set(call.id ?? `${call.type}:${gatewayCalls.size}`, call);
      }
      if (frame.usage) {
        promptTokens = frame.usage.prompt_tokens ?? promptTokens;
        completionTokens = frame.usage.completion_tokens ?? completionTokens;
      }

      const choice = frame.choices?.[0];
      if (!choice) continue;
      if (typeof choice.delta?.content === "string") content += choice.delta.content;
      if (choice.finish_reason) finishReason = choice.finish_reason;

      for (const delta of choice.delta?.tool_calls ?? []) {
        const index = typeof delta.index === "number" ? delta.index : 0;
        const existing = calls.get(index) ?? { id: "", name: "", arguments: "" };
        if (delta.id) existing.id = delta.id;
        if (delta.function?.name) existing.name = delta.function.name;
        if (typeof delta.function?.arguments === "string") existing.arguments += delta.function.arguments;
        calls.set(index, existing);
      }
    }
  }

  if (timer) clearTimeout(timer);

  return {
    content: content.trim(),
    toolCalls: [...calls.values()]
      .filter((call) => call.name)
      .map((call, index) => ({
        id: call.id || `call_${index}`,
        name: call.name,
        arguments: call.arguments || "{}",
      })),
    finishReason,
    promptTokens,
    completionTokens,
    answeredBy,
    gatewayCalls: [...gatewayCalls.values()],
    servedBy,
  };
}
