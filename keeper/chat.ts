/**
 * One chat call, with the reasoning-model problem handled properly.
 *
 * A reasoning model spends the token budget thinking before it answers. If the budget runs
 * out first, `content` is empty and `finish_reason` is "length" — which must NOT be read as
 * a refusal, or the benchmark records a false negative. So: give a generous budget, and on
 * an exhausted budget retry once with double.
 */
export interface ChatResult {
  text: string;
  finishReason?: string;
  reasoningTokens?: number;
  attempts: number;
  truncated: boolean;
}

const DEFAULT_MAX_TOKENS = 1200;

interface ChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function chat(options: ChatOptions): Promise<ChatResult> {
  const url = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let budget = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  let attempts = 0;

  while (attempts < 2) {
    attempts += 1;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: options.model,
        // deliberately no temperature: several providers reject it on reasoning models
        max_tokens: budget,
        messages: options.messages,
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`${options.model} returned ${response.status}: ${detail.slice(0, 200)}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{
        message?: { content?: string | null; reasoning_content?: string | null };
        finish_reason?: string;
      }>;
      usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
    };

    const choice = body.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    const finishReason = choice?.finish_reason;
    const reasoningTokens = body.usage?.completion_tokens_details?.reasoning_tokens;

    if (text) {
      return { text, finishReason, reasoningTokens, attempts, truncated: finishReason === "length" };
    }

    // empty answer: if the budget was the reason, double it and try once more
    if (finishReason === "length") {
      budget *= 2;
      continue;
    }

    throw new Error(`${options.model} returned no answer (finish_reason: ${finishReason ?? "unknown"})`);
  }

  throw new Error(
    `${options.model} exhausted ${budget} tokens on reasoning without producing an answer. Raise MODEL_*_MAX_TOKENS.`
  );
}
