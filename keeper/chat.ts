/**
 * One chat call, with the reasoning-model problem handled properly, and optional gateway
 * fallback.
 *
 * Fallback exists because a router can survive a provider outage. It is dangerous for a
 * benchmark: if a request silently lands on a different model, the verdict describes a model
 * that was never under test. So a substituted answer is always reported, never hidden.
 */
export interface ChatResult {
  text: string;
  finishReason?: string;
  reasoningTokens?: number;
  promptTokens: number;
  completionTokens: number;
  attempts: number;
  truncated: boolean;
  /** The model id that actually answered — not necessarily the one requested. */
  model: string;
  /** True when the answer came from the fallback model. */
  substituted: boolean;
}

export class ReasoningBudgetError extends Error {}

const DEFAULT_MAX_TOKENS = 1200;

interface ChatOptions {
  baseUrl: string;
  apiKey: string;
  /** Otari authenticates with an Otari-Key header; everything else uses a Bearer token. */
  authMode?: "bearer" | "otari";
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens?: number;
  timeoutMs?: number;
  /** Default true. Set false only to compare against the non-streaming path. */
  stream?: boolean;
  fallbackModel?: string;
}

interface RawReply {
  text: string;
  finishReason?: string;
  reasoningTokens?: number;
  promptTokens: number;
  completionTokens: number;
  attempts: number;
}

async function callModel(options: ChatOptions, model: string): Promise<RawReply> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let budget = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const streaming = options.stream !== false;
  // Two independent budgets of attempts. Sharing one counter meant a single 504 consumed the
  // retry that a reasoning model needed, and the model was recorded as "exhausted" for an
  // infrastructure fault it never saw.
  let budgetTries = 0;
  let transientTries = 0;
  let attempts = 0;

  for (;;) {
    attempts += 1;

    const body = JSON.stringify({
      model,
      // deliberately no temperature: several providers reject it on reasoning models
      max_tokens: budget,
      messages: options.messages,
      // Streaming is not a preference. A non-streamed request that takes longer than about thirty
      // seconds is killed by the edge with a 504, which looked exactly like a model outage for
      // most of a day. Streaming sends bytes immediately and completes.
      ...(streaming ? { stream: true, stream_options: { include_usage: true } } : {}),
    });

    // A streaming response has no single duration: 1600 tokens can take a while and still be
    // healthy. What matters is that bytes keep arriving, so the timeout resets on every chunk.
    const idleMs = options.timeoutMs ?? 90_000;
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleMs);
    };
    bump();

    let response: Response;
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey
          ? options.authMode === "otari"
            ? { "Otari-Key": options.apiKey }
            : { authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (idleTimer) clearTimeout(idleTimer);
      const detail = (await response.text().catch(() => "")).replace(/<[^>]+>/g, " ").slice(0, 160);
      // A gateway timeout is transient. Under parallel load providers shed requests, so this
      // backs off rather than giving up on the first 502.
      const transient = [429, 500, 502, 503, 504].includes(response.status);
      if (transient && transientTries < 3) {
        transientTries += 1;
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** transientTries));
        continue;
      }
      throw new Error(`${model} returned ${response.status}: ${detail}`);
    }

    let text = "";
    let finishReason: string | undefined;
    let reasoningTokens: number | undefined;
    let promptTokens = 0;
    let completionTokens = 0;

    if (streaming && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          // Any byte counts as life; only silence trips the timeout.
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
            const choice = frame.choices?.[0];
            if (typeof choice?.delta?.content === "string") text += choice.delta.content;
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            if (frame.usage) {
              promptTokens = frame.usage.prompt_tokens ?? promptTokens;
              completionTokens = frame.usage.completion_tokens ?? completionTokens;
              reasoningTokens =
                frame.usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
            }
          }
        }
      } catch (cause) {
        // A stream cut mid-flight is the streaming equivalent of a dropped connection: worth
        // retrying, and not evidence about the model.
        if (idleTimer) clearTimeout(idleTimer);
        if (transientTries < 3) {
          transientTries += 1;
          await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** transientTries));
          continue;
        }
        throw new Error(`${model} stream terminated: ${String(cause).slice(0, 120)}`);
      }
    } else {
      const parsed = (await response.json()) as {
        choices?: Array<{
          message?: { content?: string | null };
          finish_reason?: string;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      const choice = parsed.choices?.[0];
      text = choice?.message?.content ?? "";
      finishReason = choice?.finish_reason;
      reasoningTokens = parsed.usage?.completion_tokens_details?.reasoning_tokens;
      promptTokens = parsed.usage?.prompt_tokens ?? 0;
      completionTokens = parsed.usage?.completion_tokens ?? 0;
    }

    text = text.trim();
    if (idleTimer) clearTimeout(idleTimer);

    if (text) {
      return { text, finishReason, reasoningTokens, promptTokens, completionTokens, attempts };
    }

    // `length` with no content is what a reasoning model looks like when it thinks itself out of
    // room. Retry once with double the room, then report the budget it actually had.
    if (finishReason === "length" && budgetTries < 2) {
      budgetTries += 1;
      budget *= 2;
      continue;
    }

    if (finishReason === "length") {
      throw new ReasoningBudgetError(
        `${model} exhausted ${budget} tokens on reasoning without producing an answer. Raise MODEL_*_MAX_TOKENS.`
      );
    }

    throw new Error(`${model} returned no answer (finish_reason: ${finishReason ?? "unknown"})`);
  }
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  try {
    const reply = await callModel(options, options.model);
    return { ...reply, truncated: reply.finishReason === "length", model: options.model, substituted: false };
  } catch (cause) {
    // A reasoning budget is a property of the model under test, not an infrastructure fault.
    // Falling back would answer for a different model and corrupt the verdict.
    if (cause instanceof ReasoningBudgetError) throw cause;

    const fallback = options.fallbackModel;
    if (!fallback || fallback === options.model) throw cause;

    console.warn(`gateway fallback: ${options.model} failed (${String(cause).slice(0, 120)}), retrying on ${fallback}`);
    const reply = await callModel(options, fallback);
    return { ...reply, truncated: reply.finishReason === "length", model: fallback, substituted: true };
  }
}
