import { z } from "zod";
import catalog from "../data/catalog.json";
import destinations from "../data/destinations.json";
import releaseRules from "../data/release-rules.json";
import type { ToolSpec } from "./llm/types.js";

type ReleaseRule = (typeof releaseRules)[number];

type Tool = {
  spec: ToolSpec;
  run: (rawInput: unknown) => unknown;
};

// The model sees the JSON schema generated from `input`, and that same schema checks the
// arguments it sends back. Invalid arguments are returned as an error result, not executed.
function defineTool<Input extends z.ZodObject>(
  name: string,
  description: string,
  input: Input,
  run: (input: z.output<Input>) => unknown,
): Tool {
  const inputSchema = z.toJSONSchema(input, { io: "input" }) as Record<string, unknown>;
  delete inputSchema.$schema;
  return {
    spec: { name, description, inputSchema },
    run(rawInput) {
      const parsed = input.safeParse(rawInput);
      if (!parsed.success) {
        return { found: false, error: `Invalid arguments for ${name}: ${z.prettifyError(parsed.error)}` };
      }
      return run(parsed.data);
    },
  };
}

const text = (description: string) => z.string().trim().min(1).describe(description);

const SEARCH_LIMIT = 5;

function wordsOf(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

const lookupCatalog = defineTool(
  "catalog",
  "Look up one catalog row by dataset id. Returns kind, classification, and owner.",
  z.object({ datasetId: text("Dataset id from the request, such as DS-01.") }),
  ({ datasetId }) => {
    const row = catalog.find((item) => item.id.toLowerCase() === datasetId.toLowerCase());
    if (!row) return { found: false, missing: "catalog", datasetId };
    return { found: true, row };
  },
);

// A row is a candidate when its name shares a word with the query. Only id and name come back,
// so the caller has to choose a candidate and then read it with the catalog tool.
const searchCatalog = defineTool(
  "catalog_search",
  "Search the catalog by dataset name or description, for a request that gives no dataset id. Returns up to five candidate rows with id and name only. It can return several candidates, or none. To read a candidate's kind, classification, and owner, call catalog with its id.",
  z.object({ query: text("The words the request uses for the dataset.") }),
  ({ query }) => {
    const queryWords = new Set(wordsOf(query));
    const candidates = catalog
      .map((row) => ({ row, shared: wordsOf(row.name).filter((word) => queryWords.has(word)).length }))
      .filter((candidate) => candidate.shared > 0)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, SEARCH_LIMIT)
      .map(({ row }) => ({ id: row.id, name: row.name }));
    return { found: candidates.length > 0, candidates };
  },
);

const lookupDestination = defineTool(
  "destinations",
  "Look up one destination row by name. Call only when the request names a destination.",
  z.object({ destination: text("Destination words from the request.") }),
  ({ destination }) => {
    const query = destination.toLowerCase();
    const exact = destinations.filter((row) => row.destination.toLowerCase() === query);
    const partial = destinations.filter((row) => row.destination.toLowerCase().includes(query));
    const chosen = exact.length === 1 ? exact[0] : partial.length === 1 ? partial[0] : undefined;
    if (!chosen) return { found: false, missing: "destination", destination };
    return { found: true, row: { id: chosen.destination, kinds: chosen.kinds } };
  },
);

const lookupReleaseRules = defineTool(
  "release_rules",
  "Look up the release rule for a kind and classification. Call only after catalog and a destination row.",
  z.object({
    classification: text("Classification from the catalog row.").toLowerCase(),
    kind: text("Kind from the catalog row.").toLowerCase(),
  }),
  ({ classification, kind }) => {
    if (classification === "blank") return { found: false, missing: "classification" };
    const match = releaseRules.find((rule) => samePair(rule, classification, kind));
    if (match) return { found: true, row: match };
    const other = releaseRules.find((rule) => rule.id === "reg-other-pair");
    if (other) return { found: true, row: other };
    return { found: false, missing: "release-rules" };
  },
);

function samePair(rule: ReleaseRule, classification: string, kind: string): boolean {
  const ruleClassification = "classification" in rule ? rule.classification : undefined;
  const ruleKind = "kind" in rule ? rule.kind : undefined;
  return ruleClassification?.toLowerCase() === classification && ruleKind?.toLowerCase() === kind;
}

const TOOLS = [lookupCatalog, searchCatalog, lookupDestination, lookupReleaseRules];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((tool) => tool.spec);

export function runTool(name: string, input: unknown): unknown {
  const tool = TOOLS.find((candidate) => candidate.spec.name === name);
  if (!tool) return { found: false, error: `Unknown tool: ${name}.` };
  return tool.run(input);
}
