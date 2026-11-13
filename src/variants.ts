import type { AgentRun } from "./agent.js";
import type { LlmConfig } from "./llm/index.js";
import { decideWithoutModel } from "./rules-only.js";

type VariantBase = {
  name: string;
  description: string;
  // Runs only when named with --variant. Used for a variant that needs a local server.
  optional?: boolean;
};

export type AgentVariant = VariantBase & {
  kind: "agent";
  promptFile: string;
  llm: LlmConfig;
  temperature: number;
  maxTurns: number;
};

// No model. sourceFile is stored where a prompt file would be.
export type ScriptVariant = VariantBase & {
  kind: "script";
  sourceFile: string;
  decide: (request: string) => AgentRun;
};

export type Variant = AgentVariant | ScriptVariant;

const SONNET: LlmConfig = { provider: "bedrock", modelId: "us.anthropic.claude-sonnet-4-6" };

// procedure-gpt-oss calls these weights on Bedrock. procedure-local calls the same model through Ollama.
const GPT_OSS_BEDROCK: LlmConfig = { provider: "bedrock", modelId: "openai.gpt-oss-20b-1:0" };
const GPT_OSS_LOCAL: LlmConfig = { provider: "ollama", model: "gpt-oss:20b" };

export const VARIANTS: Variant[] = [
  {
    kind: "script",
    name: "rules-only",
    description: "No model. Code reads ids, full catalog names and destination names from the request, then applies the rulebook.",
    sourceFile: "src/rules-only.ts",
    decide: decideWithoutModel,
  },
  {
    kind: "agent",
    name: "baseline",
    description: "Short prompt: the task, the four labels, the output format. No procedure.",
    promptFile: "prompts/baseline.txt",
    llm: SONNET,
    temperature: 0,
    maxTurns: 8,
  },
  {
    kind: "agent",
    name: "rulebook",
    description: "Baseline prompt plus the rulebook text as written. No steps, no tool order, no citation instructions.",
    promptFile: "prompts/rulebook.txt",
    llm: SONNET,
    temperature: 0,
    maxTurns: 8,
  },
  {
    kind: "agent",
    name: "procedure",
    description: "The rulebook as numbered steps, with what to cite at each step.",
    promptFile: "prompts/procedure.txt",
    llm: SONNET,
    temperature: 0,
    maxTurns: 8,
  },
  {
    kind: "agent",
    name: "procedure-gpt-oss",
    description: "Same procedure prompt on gpt-oss-20b, an open-weight model that can run on-prem.",
    promptFile: "prompts/procedure.txt",
    llm: GPT_OSS_BEDROCK,
    temperature: 0,
    maxTurns: 8,
  },
  {
    kind: "agent",
    name: "procedure-local",
    description: "Same procedure prompt on gpt-oss-20b through a local Ollama server.",
    promptFile: "prompts/procedure.txt",
    llm: GPT_OSS_LOCAL,
    temperature: 0,
    maxTurns: 8,
    optional: true,
  },
];
