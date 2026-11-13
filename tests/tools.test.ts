import { describe, expect, it } from "vitest";
import { runTool, TOOL_SPECS } from "../src/tools.js";

describe("tools", () => {
  it("gives the model a JSON schema generated from each tool's input schema", () => {
    const catalog = TOOL_SPECS.find((tool) => tool.name === "catalog");
    expect(TOOL_SPECS.map((tool) => tool.name)).toEqual(["catalog", "catalog_search", "destinations", "release_rules"]);
    expect(catalog?.inputSchema).toMatchObject({
      type: "object",
      required: ["datasetId"],
      properties: { datasetId: { type: "string", description: "Dataset id from the request, such as DS-01." } },
    });
    expect(catalog?.inputSchema).not.toHaveProperty("$schema");
  });

  it("runs a tool on valid arguments, trimming and ignoring case", () => {
    expect(runTool("catalog", { datasetId: " ds-14 " })).toMatchObject({ found: true, row: { id: "DS-14" } });
    expect(runTool("release_rules", { classification: "Restricted", kind: "Raw Curves" }))
      .toMatchObject({ found: true, row: { id: "reg-restricted-raw-curves" } });
  });

  it("returns invalid arguments to the model as an error result", () => {
    expect(runTool("catalog", { datasetId: 14 })).toMatchObject({
      found: false,
      error: expect.stringContaining("Invalid arguments for catalog"),
    });
    expect(runTool("release_rules", { kind: "metadata" })).toMatchObject({
      found: false,
      error: expect.stringContaining("classification"),
    });
    expect(runTool("destinations", "Acme")).toMatchObject({ found: false });
    expect(runTool("weather", {})).toEqual({ found: false, error: "Unknown tool: weather." });
  });
});
