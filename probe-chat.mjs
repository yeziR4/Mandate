import { chat } from "./keeper/chat.ts";

// Prove the reasoning-model path before deploying: same model the user tested.
const baseUrl = "https://api.river.ai/v1";
const apiKey = process.env.RIVER_API_KEY ?? "";
if (!apiKey) {
  console.error("RIVER_API_KEY missing");
  process.exit(1);
}

const result = await chat({
  baseUrl,
  apiKey,
  model: "GLM-5.3",
  maxTokens: 400,
  messages: [{ role: "user", content: "reply with the single word ok" }],
});

console.log(JSON.stringify(result, null, 2));
