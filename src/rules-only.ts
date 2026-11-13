import catalog from "../data/catalog.json";
import destinations from "../data/destinations.json";
import type { AgentRun, ToolCall } from "./agent.js";
import type { Decision } from "./decision.js";
import { runTool } from "./tools.js";

type CatalogRow = { id: string; name: string; kind: string; classification: string; owner: string | null };
type Found<Row> = { found: true; row: Row } | { found: false };

const catalogRows: CatalogRow[] = catalog;

// The rulebook applied in code, with no model. Reads dataset ids, full catalog names, and
// destination names from the request, and abstains when it cannot tell which row is meant.
export function decideWithoutModel(request: string): AgentRun {
  const started = performance.now();
  const toolCalls: ToolCall[] = [];
  const call = <Result>(name: string, input: Record<string, string>): Result => {
    const result = runTool(name, input);
    toolCalls.push({ name, input, result });
    return result as Result;
  };

  const decision = decideRequest(request, call);
  return {
    decision,
    finalText: JSON.stringify(decision),
    toolCalls,
    modelCalls: 0,
    latencyMs: Math.round(performance.now() - started),
    inputTokens: 0,
    outputTokens: 0,
  };
}

type Call = <Result>(name: string, input: Record<string, string>) => Result;

function decideRequest(request: string, call: Call): Decision {
  const text = request.toLowerCase();

  const ids = [...new Set([...request.matchAll(/\bds-?(\d+)\b/gi)].map((match) => `DS-${match[1]}`))];
  if (ids.length > 1) return { label: "abstain", citedRowId: ids[0] };

  let datasetId = ids[0];
  if (!datasetId) {
    const namedRows = catalogRows.filter((row) => text.includes(row.name.toLowerCase()));
    if (namedRows.length !== 1) return { label: "abstain", citedRowId: namedRows[0]?.id };
    datasetId = namedRows[0].id;
  }

  const catalog = call<Found<CatalogRow>>("catalog", { datasetId });
  if (!catalog.found) return { label: "abstain", citedRowId: datasetId };
  const dataset = catalog.row;
  if (dataset.classification === "blank") return { label: "abstain", citedRowId: dataset.id };

  const byFullName = destinations.filter((row) => text.includes(row.destination.toLowerCase()));
  const byFirstWord = destinations.filter((row) =>
    new RegExp(`\\b${row.destination.split(" ")[0].toLowerCase()}\\b`).test(text));
  const namedDestinations = byFullName.length > 0 ? byFullName : byFirstWord;
  if (namedDestinations.length > 1) return { label: "abstain", citedRowId: dataset.id };
  if (namedDestinations.length === 0) {
    const words = /\bto\s+([^.?!,]+)/i.exec(request)?.[1]?.trim();
    if (words) call("destinations", { destination: words });
    return { label: "deny", citedRowId: words };
  }

  const destination = call<Found<{ id: string; kinds: string[] }>>("destinations", {
    destination: namedDestinations[0].destination,
  });
  if (!destination.found) return { label: "deny", citedRowId: namedDestinations[0].destination };
  if (!destination.row.kinds.includes(dataset.kind)) return { label: "deny", citedRowId: destination.row.id };

  const rule = call<Found<{ id: string }>>("release_rules", {
    classification: dataset.classification,
    kind: dataset.kind,
  });
  if (!rule.found) return { label: "abstain", citedRowId: dataset.id };
  if (rule.row.id === "reg-1") return { label: "allow", citedRowId: "reg-1" };
  if (rule.row.id === "reg-restricted-raw-curves") {
    return { label: dataset.owner ? "needs-owner" : "abstain", citedRowId: rule.row.id };
  }
  return { label: "deny", citedRowId: rule.row.id };
}
