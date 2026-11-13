import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import type { ChatMessage, ChatReply, ChatRequest, LlmService, ToolSpec } from "./types.js";

export type BedrockOptions = {
  modelId: string;
  region: string;
  profile: string;
};

export class BedrockLlmService implements LlmService {
  readonly id: string;
  private readonly client: BedrockRuntimeClient;

  constructor(private readonly options: BedrockOptions) {
    this.id = `bedrock:${options.modelId}`;
    this.client = new BedrockRuntimeClient({
      region: options.region,
      credentials: fromIni({ profile: options.profile }),
      maxAttempts: 5,
      retryMode: "adaptive",
    });
  }

  async chat(request: ChatRequest): Promise<ChatReply> {
    const response = await this.client.send(new ConverseCommand({
      modelId: this.options.modelId,
      system: [{ text: request.system }],
      messages: request.messages.map(toBedrockMessage),
      inferenceConfig: { maxTokens: request.maxTokens, temperature: request.temperature },
      toolConfig: { tools: request.tools.map(toBedrockTool) },
    }));

    const content = response.output?.message?.content;
    if (!content) throw new Error("model returned an empty response");
    return {
      text: content.map((block) => block.text ?? "").join("\n").trim(),
      toolCalls: content.flatMap((block) => block.toolUse?.toolUseId && block.toolUse.name
        ? [{ id: block.toolUse.toolUseId, name: block.toolUse.name, input: block.toolUse.input }]
        : []),
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    };
  }
}

function toBedrockTool(tool: ToolSpec): Tool {
  return {
    toolSpec: {
      name: tool.name,
      description: tool.description,
      inputSchema: { json: tool.inputSchema as never },
    },
  };
}

function toBedrockMessage(message: ChatMessage): Message {
  if (message.role === "user") return { role: "user", content: [{ text: message.text }] };
  if (message.role === "tool") {
    return {
      role: "user",
      content: message.results.map((result) => ({
        toolResult: { toolUseId: result.id, content: [{ text: result.content }] },
      })),
    };
  }
  // Bedrock rejects empty text blocks, so an assistant turn with only tool calls has no text block.
  const content: ContentBlock[] = message.text ? [{ text: message.text }] : [];
  for (const call of message.toolCalls) {
    content.push({ toolUse: { toolUseId: call.id, name: call.name, input: call.input as never } });
  }
  return { role: "assistant", content };
}
