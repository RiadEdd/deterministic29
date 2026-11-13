import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CaseSet } from "./cases.js";
import { LABELS, type Label } from "./decision.js";
import {
  citationAccepted,
  describeCall,
  OUTCOME_ORDER,
  outcomeOf,
  percent,
  type ConfusionMatrix,
  type Outcome,
  type RunStats,
  type ScoredCase,
  type Scores,
} from "./score.js";

// One file per variant per run: results/<batchId>/<variant>.run-<n>.json.
// Earlier files omit caseSet (those runs used the core set), temperature, and maxTurns.
export type RunRecord = {
  batchId: string;
  caseSet?: CaseSet;
  variant: string;
  description: string;
  modelId: string;
  temperature?: number;
  maxTurns?: number;
  promptFile: string;
  promptSha: string;
  systemPrompt: string;
  run: number;
  startedAt?: string;
  finishedAt?: string;
  cases: ScoredCase[];
  scores: Scores;
  confusion: ConfusionMatrix;
  stats: RunStats;
};

const METRICS: { key: keyof Scores; label: string; goodWhenHigh: boolean }[] = [
  { key: "unsafeAllowRate", label: "Unsafe-allow rate", goodWhenHigh: false },
  { key: "approvalRate", label: "Approval rate", goodWhenHigh: true },
  { key: "labelAccuracy", label: "Label accuracy", goodWhenHigh: true },
  { key: "citationValidity", label: "Citation validity", goodWhenHigh: true },
  { key: "silentAbstention", label: "Silent abstention", goodWhenHigh: true },
  { key: "overAbstainRate", label: "Over-abstain rate", goodWhenHigh: false },
];

export function readBatch(resultsDir: string, batchId: string): RunRecord[] {
  const dir = join(resultsDir, batchId);
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as RunRecord)
    .sort((a, b) => a.variant.localeCompare(b.variant) || a.run - b.run);
}

export function listBatches(resultsDir: string): string[] {
  if (!existsSync(resultsDir)) return [];
  return readdirSync(resultsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

// Rewrites every batch page and the index from the run files on disk.
export function writeReports(resultsDir: string): void {
  const batches = listBatches(resultsDir);
  for (const batchId of batches) {
    writeFileSync(join(resultsDir, batchId, "report.html"), batchPage(batchId, readBatch(resultsDir, batchId)));
  }
  writeFileSync(
    join(resultsDir, "index.html"),
    indexPage(batches.map((batchId) => ({ batchId, records: readBatch(resultsDir, batchId) }))),
  );
}

function escape(text: unknown): string {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function groupByVariant(records: RunRecord[]): Map<string, RunRecord[]> {
  const groups = new Map<string, RunRecord[]>();
  for (const record of records) groups.set(record.variant, [...(groups.get(record.variant) ?? []), record]);
  return groups;
}

function summary(values: number[]): string {
  const real = values.filter((value) => !Number.isNaN(value));
  if (real.length === 0) return "n/a";
  const mean = real.reduce((sum, value) => sum + value, 0) / real.length;
  const low = Math.min(...real);
  const high = Math.max(...real);
  return low === high ? percent(mean) : `${percent(mean)} <span class="range">(${percent(low)}–${percent(high)})</span>`;
}

function countWhere(records: RunRecord[], keep: (row: ScoredCase) => boolean): string {
  const rows = records.flatMap((record) => record.cases);
  return `${rows.filter(keep).length} of ${rows.length}`;
}

function variantSummaryTable(records: RunRecord[]): string {
  const rows = [...groupByVariant(records)].map(([variant, runs]) => {
    const first = runs[0];
    const latency = runs.map((run) => run.stats.medianLatencyMs);
    const tokens = runs.reduce((sum, run) => sum + run.stats.inputTokens + run.stats.outputTokens, 0);
    const cases = runs.reduce((sum, run) => sum + run.cases.length, 0);
    return `<tr>
      <th>${escape(variant)}<div class="sub">${escape(first.description)}</div><div class="sub mono">${escape(first.modelId)} · ${escape(first.promptFile)} @ ${escape(first.promptSha)}${first.temperature === undefined ? "" : ` · temperature ${first.temperature}`}</div></th>
      <td>${runs.length}</td>
      ${METRICS.map((metric) => `<td>${summary(runs.map((run) => run.scores[metric.key]))}</td>`).join("")}
      <td>${countWhere(runs, (row) => outcomeOf(row) === "allow" && row.gold !== "allow")}</td>
      <td>${countWhere(runs, (row) => row.run.decision === null)}</td>
      <td>${Math.round(latency.reduce((sum, value) => sum + value, 0) / latency.length)} ms</td>
      <td>${Math.round(tokens / cases)}</td>
    </tr>`;
  });
  return `<table>
    <thead><tr><th>Variant</th><th>Runs</th>${METRICS.map((metric) => `<th>${metric.label}</th>`).join("")}<th>Unsafe allows</th><th>No decision</th><th>Median latency</th><th>Tokens per case</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>
  <p class="note">Rates are the mean over runs, with the range across runs in brackets when they differ. Unsafe allows and no-decision counts are pooled over all runs.</p>`;
}

function runTable(records: RunRecord[]): string {
  const rows = records.map((record) => `<tr>
    <th>${escape(record.variant)} · run ${record.run}</th>
    ${METRICS.map((metric) => `<td>${percent(record.scores[metric.key])}</td>`).join("")}
    <td>${record.stats.noDecision}</td>
    <td>${record.stats.meanToolCalls.toFixed(1)}</td>
    <td>${record.stats.medianLatencyMs} / ${record.stats.maxLatencyMs} ms</td>
    <td>${record.stats.inputTokens} / ${record.stats.outputTokens}</td>
  </tr>`);
  return `<table>
    <thead><tr><th>Run</th>${METRICS.map((metric) => `<th>${metric.label}</th>`).join("")}<th>No decision</th><th>Tool calls per case</th><th>Latency median / max</th><th>Tokens in / out</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

function confusionTables(records: RunRecord[]): string {
  return [...groupByVariant(records)].map(([variant, runs]) => {
    const total = (gold: Label, outcome: Outcome) =>
      runs.reduce((sum, run) => sum + run.confusion[gold][outcome], 0);
    const body = LABELS.map((gold) => `<tr><th>${gold}</th>${OUTCOME_ORDER.map((outcome) => {
      const value = total(gold, outcome);
      const kind = value === 0 ? "zero" : outcome === gold ? "ok" : outcome === "allow" ? "unsafe" : "wrong";
      return `<td class="cell ${kind}">${value}</td>`;
    }).join("")}</tr>`).join("");
    return `<div class="matrix">
      <h3>${escape(variant)} <span class="sub">${runs.length} run${runs.length === 1 ? "" : "s"} pooled</span></h3>
      <table><thead><tr><th>gold ↓ / output →</th>${OUTCOME_ORDER.map((outcome) => `<th>${outcome}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>
    </div>`;
  }).join("");
}

function cellKind(row: ScoredCase): string {
  const outcome = outcomeOf(row);
  if (outcome === "none") return "none";
  if (outcome !== row.gold) return outcome === "allow" ? "unsafe" : "wrong";
  return citationAccepted(row.acceptableCitations, row.run.decision?.citedRowId) ? "ok" : "okcite";
}

function caseGrid(records: RunRecord[]): string {
  const cases = records[0]?.cases ?? [];
  const header = records.map((record) => `<th class="runhead">${escape(record.variant)}<br>run ${record.run}</th>`).join("");
  const rows = cases.map((testCase, index) => {
    const cells = records.map((record) => {
      const row = record.cases[index];
      const cited = row.run.decision?.citedRowId ?? row.run.error ?? "";
      return `<td class="cell ${cellKind(row)}" title="cited: ${escape(cited)}"><a href="#case-${testCase.n}">${escape(outcomeOf(row))}</a></td>`;
    }).join("");
    return `<tr><th>${testCase.n}</th><td class="request">${escape(testCase.request)}</td><td>${testCase.gold}</td>${cells}</tr>`;
  }).join("");
  return `<table class="grid">
    <thead><tr><th>#</th><th>Request</th><th>Gold</th>${header}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="legend"><span class="cell ok">correct</span> <span class="cell okcite">correct label, citation not accepted</span> <span class="cell wrong">wrong</span> <span class="cell unsafe">unsafe allow</span> <span class="cell none">no decision</span></p>`;
}

function caseDetails(records: RunRecord[]): string {
  const cases = records[0]?.cases ?? [];
  return cases.map((testCase, index) => {
    const runs = records.map((record) => {
      const row = record.cases[index];
      const calls = row.run.toolCalls.map((call) => `<li class="mono">${escape(describeCall(call))}</li>`).join("");
      return `<div class="run">
        <div><span class="cell ${cellKind(row)}">${escape(outcomeOf(row))}</span> <b>${escape(record.variant)} · run ${record.run}</b>
          · cited <span class="mono">${escape(row.run.decision?.citedRowId ?? "none")}</span>
          · ${row.run.latencyMs} ms · ${row.run.modelCalls} model calls · ${row.run.inputTokens}/${row.run.outputTokens} tokens</div>
        <ol>${calls || "<li>No tool calls.</li>"}</ol>
        ${row.run.error ? `<div class="error">Error: ${escape(row.run.error)}</div>` : ""}
        ${row.run.finalText ? `<pre>${escape(row.run.finalText)}</pre>` : ""}
      </div>`;
    }).join("");
    return `<details id="case-${testCase.n}">
      <summary><b>Case ${testCase.n}</b> · gold <b>${testCase.gold}</b> · ${escape(testCase.request)}</summary>
      <div class="sub">Acceptable citations: <span class="mono">${testCase.acceptableCitations.map(escape).join(", ")}</span></div>
      ${runs}
    </details>`;
  }).join("");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title>
<style>
  body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #1d1d1f; max-width: 1400px; }
  h1 { font-size: 22px; margin-bottom: 4px; } h2 { font-size: 17px; margin-top: 36px; } h3 { font-size: 14px; margin: 0 0 6px; }
  table { border-collapse: collapse; margin: 8px 0; display: block; overflow-x: auto; max-width: 100%; }
  td.cell, .grid td:nth-child(3) { white-space: nowrap; } th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: left; vertical-align: top; }
  thead th { background: #f5f5f7; font-weight: 600; } .sub { color: #6e6e73; font-size: 12px; font-weight: normal; } .mono, pre { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .range { color: #6e6e73; font-size: 12px; } .note, .legend { color: #6e6e73; font-size: 12px; }
  .cell { text-align: center; border-radius: 3px; padding: 2px 6px; } .cell a { color: inherit; text-decoration: none; }
  .ok { background: #d8f5dd; } .okcite { background: #eef7c8; } .wrong { background: #ffe3b8; } .unsafe { background: #ff9c9c; font-weight: 600; } .none { background: #e3e3e8; } .zero { color: #c0c0c5; }
  .grid .request { max-width: 460px; } .runhead { font-size: 12px; text-align: center; }
  .matrix { display: inline-block; margin: 0 28px 16px 0; vertical-align: top; }
  details { border: 1px solid #ddd; border-radius: 6px; padding: 8px 12px; margin: 6px 0; } summary { cursor: pointer; }
  .run { border-top: 1px solid #eee; margin-top: 8px; padding-top: 8px; } .run ol { margin: 4px 0; } pre { background: #f5f5f7; padding: 6px 8px; white-space: pre-wrap; margin: 4px 0; }
  .error { color: #b00020; }
</style></head><body>${body}</body></html>`;
}

function batchPage(batchId: string, records: RunRecord[]): string {
  const caseCount = records[0]?.cases.length ?? 0;
  return page(`Eval ${batchId}`, `
    <p><a href="../index.html">← All batches</a></p>
    <h1>Eval batch ${escape(batchId)}</h1>
    <div class="sub">${escape(records[0]?.caseSet ?? "core")} set · ${caseCount} cases · ${records.length} runs</div>
    <h2>Variants</h2>${variantSummaryTable(records)}
    <h2>Runs</h2>${runTable(records)}
    <h2>Confusion matrices</h2>${confusionTables(records)}
    <h2>Cases</h2>${caseGrid(records)}
    <h2>Case details</h2><p class="note">Tool calls in order, the model's final reply, and the error when there was no decision.</p>${caseDetails(records)}
  `);
}

function indexPage(batches: { batchId: string; records: RunRecord[] }[]): string {
  const sections = batches.map(({ batchId, records }) => `
    <h2><a href="${escape(batchId)}/report.html">${escape(batchId)}</a> <span class="sub">${escape(records[0]?.caseSet ?? "core")} set · ${records.length} runs</span></h2>
    ${variantSummaryTable(records)}
  `).join("");
  return page("Eval results", `<h1>Eval results</h1>${sections || "<p>No runs yet.</p>"}`);
}
