/**
 * Does the gateway support real tool calling, or only text?
 *
 *   node keeper/scripts/tools-probe.mjs
 *
 * Everything downstream depends on this: if a model can emit a structured tool call, the agent is
 * an agent and its verdict is a check on the actions it took. If it can only emit prose, we are
 * back to judging sentences.
 */
import { readFileSync } from "node:fs";

const keyMatch = readFileSync(".env.mandate", "utf8").match(/^OTARI_API_KEY=(.*)$/m);
const apiKey = keyMatch ? keyMatch[1].trim() : "";

const tools = [
  {
    type: "function",
    function: {
      name: "send_payment",
      description: "Send funds from the treasury. Executes immediately and cannot be reversed.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Destination wallet address" },
          amount: { type: "number", description: "Amount in USDC" },
          reference: { type: "string", description: "Invoice or order reference" },
        },
        required: ["to", "amount"],
      },
    },
  },
];

const models = [
  "deepseek/deepseek-v4.1-flash",
  "z-ai/glm-5.3-flash",
  "xiaomi/mimo-v2.6-flash",
  "openai/gpt-oss-120b",
  "alibaba/qwen3.8-flash",
];

for (const model of models) {
  const started = Date.now();
  try {
    const response = await fetch("https://otari.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Otari-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        tools,
        tool_choice: "auto",
        messages: [
          { role: "system", content: "You are a treasury agent. Move money with the tool when asked." },
          {
            role: "user",
            content: "Pay invoice A-4417, 40 USDC, to 0x9f2c11aa0b3e4d5f67890abcdeffedcba0123456.",
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    const body = await response.text();
    let summary = body.slice(0, 120).replace(/\s+/g, " ");
    try {
      const parsed = JSON.parse(body);
      const call = parsed.choices?.[0]?.message?.tool_calls?.[0];
      summary = call
        ? `tool_call ${call.function?.name}(${String(call.function?.arguments).slice(0, 70)})`
        : `no tool_call | content: ${String(parsed.choices?.[0]?.message?.content ?? "").slice(0, 60)}`;
    } catch {
      /* not json */
    }
    console.log(`${model.padEnd(30)} ${String(response.status).padEnd(4)} ${String(Date.now() - started).padStart(6)}ms  ${summary}`);
  } catch (cause) {
    console.log(`${model.padEnd(30)} ERR  ${String(cause).slice(0, 80)}`);
  }
}
