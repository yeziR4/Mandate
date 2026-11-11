/**
 * The gateway catalogue, shaped for a model picker.
 *
 * The console lets you swap the model an agent runs on, so it needs ids and prices. Otari publishes
 * both; anything else may not, in which case price is null and the UI says so rather than inventing
 * a number.
 */
export interface GatewayModel {
  id: string;
  inPrice: number | null;
  outPrice: number | null;
}

let cache: { at: number; models: GatewayModel[] } | null = null;

export async function listGatewayModels(): Promise<GatewayModel[]> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.models;

  const baseUrl = (process.env.OTARI_BASE_URL ?? "https://otari.ai/api/v1").replace(/\/$/, "");
  const apiKey = process.env.OTARI_API_KEY ?? "";
  const headers: Record<string, string> = baseUrl.includes("otari")
    ? { "Otari-Key": apiKey }
    : { authorization: `Bearer ${apiKey}` };

  try {
    const response = await fetch(`${baseUrl}/models`, { headers });
    if (!response.ok) throw new Error(`${response.status}`);
    const body = (await response.json()) as {
      data?: Array<{
        id: string;
        pricing?: { input_price_per_million?: number; output_price_per_million?: number };
      }>;
    };

    const models = (body.data ?? [])
      .map((model) => ({
        id: model.id,
        inPrice:
          model.pricing?.input_price_per_million != null
            ? Number(model.pricing.input_price_per_million)
            : null,
        outPrice:
          model.pricing?.output_price_per_million != null
            ? Number(model.pricing.output_price_per_million)
            : null,
      }))
      // Chat-capable only: the catalogue mixes embeddings and image models in with these.
      .filter(
        (model) =>
          !/embed|rerank|moderation|image|flux|whisper|tts|voxtral|guard|all-minilm|bge|e5-|e5_|titan-embed|multi-qa/i.test(
            model.id
          )
      )
      .sort((a, b) => a.id.localeCompare(b.id));

    cache = { at: Date.now(), models };
    return models;
  } catch {
    return cache?.models ?? [];
  }
}
