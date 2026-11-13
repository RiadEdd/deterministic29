import { z } from "zod";
import type { ChatMessage, ChatReply, ChatRequest, LlmService } from "./types.js";

// Local Ollama /api/chat. Nothing leaves the machine.
// Start one with `ollama serve` and `ollama pull <model>`.

export type OllamaOptions = {
  model: string;
  baseUrl: string;
};

const OllamaToolCallSchema = z.object({
  id: z.string().optional(),
  function: z.object({ name: z.string(), arguments: z.unknown() }),
});

type OllamaToolCall = z.infer<typeof OllamaToolCallSchema>;

const OllamaResponseSchema = z.object({
  message: z.object({
    content: z.string().default(""),
    tool_calls: z.array(OllamaToolCallSchema).default([]),
  }).optional(),
  prompt_eval_count: z.number().default(0),
  eval_count: z.number().default(0),
  error: z.string().optional(),
});

type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
};

export class OllamaLlmService implements LlmService {
  readonly id: string;
  private callCount = 0;

  constructor(private readonly options: OllamaOptions) {
    this.id = `ollama:${options.model}`;
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    const response = await fetch(`${this.options.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        stream: false,
        messages: [{ role: "system", content: request.system }, ...request.messages.flatMap(toOllamaMessages)],
        tools: request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
        })),
        options: { temperature: request.temperature, num_predict: request.maxTokens },
      }),
    });
    const parsed = OllamaResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`ollama returned an unexpected response: ${z.prettifyError(parsed.error)}`);
    }
    const body = parsed.data;
    if (!response.ok || body.error) {
      throw new Error(`ollama returned ${response.status}: ${body.error ?? "no error message"}`);
    }

    // Ollama does not always give tool calls an id, and the agent needs one to pair results.
    const toolCalls = (body.message?.tool_calls ?? []).map((call) => ({
      id: call.id ?? `call-${(this.callCount += 1)}`,
      name: call.function.name,
      input: parseArguments(call.function.arguments),
    }));
    return {
      text: (body.message?.content ?? "").trim(),
      toolCalls,
      inputTokens: body.prompt_eval_count,
      outputTokens: body.eval_count,
    };
  }
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toOllamaMessages(message: ChatMessage): OllamaMessage[] {
  if (message.role === "user") return [{ role: "user", content: message.text }];
  if (message.role === "tool") {
    return message.results.map((result) => ({ role: "tool", content: result.content, tool_name: result.name }));
  }
  return [{
    role: "assistant",
    content: message.text,
    tool_calls: message.toolCalls.map((call) => ({ id: call.id, function: { name: call.name, arguments: call.input } })),
  }];
}
