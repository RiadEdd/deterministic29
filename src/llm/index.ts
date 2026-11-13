import { AWS_PROFILE, AWS_REGION } from "../model.js";
import { BedrockLlmService } from "./bedrock.js";
import { OllamaLlmService } from "./ollama.js";
import type { LlmService } from "./types.js";

export type { LlmService } from "./types.js";

export type LlmConfig =
  | { provider: "bedrock"; modelId: string }
  | { provider: "ollama"; model: string; baseUrl?: string };

const services = new Map<string, LlmService>();

// One service per model, shared by every variant that uses it.
export function llmFor(config: LlmConfig): LlmService {
  const key = JSON.stringify(config);
  const existing = services.get(key);
  if (existing) return existing;
  const service = config.provider === "bedrock"
    ? new BedrockLlmService({ modelId: config.modelId, region: AWS_REGION, profile: AWS_PROFILE })
    : new OllamaLlmService({ model: config.model, baseUrl: config.baseUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434" });
  services.set(key, service);
  return service;
}
