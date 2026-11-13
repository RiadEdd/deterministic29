import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaLlmService } from "../src/llm/ollama.js";

afterEach(() => vi.unstubAllGlobals());

function stubOllama(reply: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OllamaLlmService", () => {
  it("sends the system prompt, history, and tools in Ollama's chat format", async () => {
    const fetchMock = stubOllama({ message: { content: "done" }, prompt_eval_count: 12, eval_count: 3 });
    const llm = new OllamaLlmService({ model: "gpt-oss:20b", baseUrl: "http://localhost:11434" });

    const reply = await llm.chat({
      system: "procedure",
      messages: [
        { role: "user", text: "Send DS-01 to Acme Surveys." },
        { role: "assistant", text: "", toolCalls: [{ id: "a", name: "catalog", input: { datasetId: "DS-01" } }] },
        { role: "tool", results: [{ id: "a", name: "catalog", content: "{\"found\":true}" }] },
      ],
      tools: [{ name: "catalog", description: "Look up a row.", inputSchema: { type: "object" } }],
      temperature: 0,
      maxTokens: 100,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(body.model).toBe("gpt-oss:20b");
    expect(body.stream).toBe(false);
    expect(body.options).toEqual({ temperature: 0, num_predict: 100 });
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(body.messages[2].tool_calls[0].function).toEqual({ name: "catalog", arguments: { datasetId: "DS-01" } });
    expect(body.messages[3]).toEqual({ role: "tool", content: "{\"found\":true}", tool_name: "catalog" });
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "catalog", description: "Look up a row.", parameters: { type: "object" } },
    });
    expect(reply).toEqual({ text: "done", toolCalls: [], inputTokens: 12, outputTokens: 3 });
  });

  it("gives tool calls an id when Ollama does not, and parses string arguments", async () => {
    stubOllama({
      message: {
        content: "",
        tool_calls: [
          { function: { name: "catalog", arguments: { datasetId: "DS-14" } } },
          { function: { name: "destinations", arguments: "{\"destination\":\"Acme\"}" } },
        ],
      },
    });
    const llm = new OllamaLlmService({ model: "m", baseUrl: "http://x" });
    const reply = await llm.chat({ system: "", messages: [], tools: [], temperature: 0, maxTokens: 10 });

    expect(reply.toolCalls.map((call) => call.name)).toEqual(["catalog", "destinations"]);
    expect(new Set(reply.toolCalls.map((call) => call.id)).size).toBe(2);
    expect(reply.toolCalls[1].input).toEqual({ destination: "Acme" });
  });

  it("raises the server's error message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "model not found" }), { status: 404 })));
    const llm = new OllamaLlmService({ model: "missing", baseUrl: "http://x" });
    await expect(llm.chat({ system: "", messages: [], tools: [], temperature: 0, maxTokens: 10 }))
      .rejects.toThrow("ollama returned 404: model not found");
  });
});
