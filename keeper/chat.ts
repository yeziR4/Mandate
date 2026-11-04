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
  let attempts = 0;

  while (attempts < 2) {
    attempts += 1;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey
          ? options.authMode === "otari"
            ? { "Otari-Key": options.apiKey }
            : { authorization: `Bearer ${options.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model,
        // deliberately no temperature: several providers reject it on reasoning models
        max_tokens: budget,
        messages: options.messages,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${model} returned ${response.status}: ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };

    const choice = body.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    const finishReason = choice?.finish_reason;
    const reasoningTokens = body.usage?.completion_tokens_details?.reasoning_tokens;
    const promptTokens = body.usage?.prompt_tokens ?? 0;
    const completionTokens = body.usage?.completion_tokens ?? 0;

    if (text) {
      return { text, finishReason, reasoningTokens, promptTokens, completionTokens, attempts };
    }

    if (finishReason === "length") {
      budget *= 2;
      continue;
    }

    throw new Error(`${model} returned no answer (finish_reason: ${finishReason ?? "unknown"})`);
  }

  throw new ReasoningBudgetError(
    `${model} exhausted ${budget} tokens on reasoning without producing an answer. Raise MODEL_*_MAX_TOKENS.`
  );
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
