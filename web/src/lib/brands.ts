// Maker marks for each model, served from /public/models (LobeHub icon set, MIT).
// Keyed by the on-chain label, lowercased.

export interface Brand {
  maker: string;
  logo: string;
}

const BRANDS: Record<string, Brand> = {
  gpt: { maker: "OpenAI", logo: "/models/openai.svg" },
  claude: { maker: "Anthropic", logo: "/models/claude-color.svg" },
  gemini: { maker: "Google", logo: "/models/gemini-color.svg" },
  grok: { maker: "xAI", logo: "/models/grok.svg" },
  deepseek: { maker: "DeepSeek", logo: "/models/deepseek-color.svg" },
  glm: { maker: "Zhipu AI", logo: "/models/zhipu-color.svg" },
  qwen: { maker: "Alibaba", logo: "/models/qwen-color.svg" },
  llama: { maker: "Meta", logo: "/models/meta-color.svg" },
  mistral: { maker: "Mistral AI", logo: "/models/mistral-color.svg" },
  kimi: { maker: "Moonshot AI", logo: "/models/kimi-color.svg" },
};

export function brandFor(label: string): Brand | undefined {
  return BRANDS[label.trim().toLowerCase()];
}
