import { parseDecision, type Decision } from "./decision.js";
import type { ChatMessage, LlmService } from "./llm/types.js";
import { runTool, TOOL_SPECS } from "./tools.js";

export type AgentConfig = {
  systemPrompt: string;
  llm: LlmService;
  temperature: number;
  maxTurns: number;
};

export type ToolCall = {
  name: string;
  input: unknown;
  result: unknown;
};

// decision is null when the run ended without a usable answer. finalText is the model's last reply.
export type AgentRun = {
  decision: Decision | null;
  error?: string;
  finalText?: string;
  toolCalls: ToolCall[];
  modelCalls: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export async function decide(request: string, config: AgentConfig): Promise<AgentRun> {
  const run: AgentRun = {
    decision: null,
    toolCalls: [],
    modelCalls: 0,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const started = performance.now();
  try {
    run.decision = await converse(request, config, run);
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
  }
  run.latencyMs = Math.round(performance.now() - started);
  return run;
}

async function converse(request: string, config: AgentConfig, run: AgentRun): Promise<Decision> {
  const messages: ChatMessage[] = [{ role: "user", text: request }];

  for (let turn = 0; turn < config.maxTurns; turn += 1) {
    const reply = await config.llm.chat({
      system: config.systemPrompt,
      messages,
      tools: TOOL_SPECS,
      temperature: config.temperature,
      maxTokens: 1024,
    });
    run.modelCalls += 1;
    run.inputTokens += reply.inputTokens;
    run.outputTokens += reply.outputTokens;
    messages.push({ role: "assistant", text: reply.text, toolCalls: reply.toolCalls });

    if (reply.toolCalls.length > 0) {
      messages.push({
        role: "tool",
        results: reply.toolCalls.map((call) => {
          const result = runTool(call.name, call.input);
          run.toolCalls.push({ name: call.name, input: call.input, result });
          return { id: call.id, name: call.name, content: JSON.stringify(result) };
        }),
      });
      continue;
    }

    run.finalText = reply.text;
    return parseDecision(reply.text);
  }

  throw new Error("agent stopped before a decision");
}
