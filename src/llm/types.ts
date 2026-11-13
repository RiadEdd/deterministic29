// Provider-neutral chat interface. The agent loop talks only to this.

export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ToolCallRequest = {
  id: string;
  name: string;
  input: unknown;
};

export type ToolResult = {
  id: string;
  name: string;
  content: string;
};

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCallRequest[] }
  | { role: "tool"; results: ToolResult[] };

export type ChatRequest = {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  temperature: number;
  maxTokens: number;
};

export type ChatReply = {
  text: string;
  toolCalls: ToolCallRequest[];
  inputTokens: number;
  outputTokens: number;
};

export interface LlmService {
  // Shown in results, for example "bedrock:us.anthropic.claude-sonnet-4-6".
  readonly id: string;
  chat(request: ChatRequest): Promise<ChatReply>;
}
