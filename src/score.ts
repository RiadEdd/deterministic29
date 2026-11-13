import type { AgentRun, ToolCall } from "./agent.js";
import { LABELS, type Label } from "./decision.js";

export type ScoredCase = {
  n: number;
  request: string;
  gold: Label;
  acceptableCitations: string[];
  run: AgentRun;
};

export type Scores = {
  labelAccuracy: number;
  unsafeAllowRate: number;
  approvalRate: number;
  citationValidity: number;
  silentAbstention: number;
  overAbstainRate: number;
};

// "none" is a run that ended without a usable decision.
export type Outcome = Label | "none";

export type ConfusionMatrix = Record<Label, Record<Outcome, number>>;

export type RunStats = {
  noDecision: number;
  meanToolCalls: number;
  meanModelCalls: number;
  medianLatencyMs: number;
  maxLatencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export const OUTCOME_ORDER: Outcome[] = [...LABELS, "none"];

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? Number.NaN : numerator / denominator;
}

export function outcomeOf(row: ScoredCase): Outcome {
  return row.run.decision?.label ?? "none";
}

export function citationAccepted(acceptable: string[], cited: string | undefined): boolean {
  if (!cited) return false;
  const wanted = cited.trim().toLowerCase();
  return acceptable.some((id) => id.toLowerCase() === wanted);
}

export function scoreRuns(rows: ScoredCase[]): Scores {
  const count = (keep: (row: ScoredCase) => boolean) => rows.filter(keep).length;
  const correct = rows.filter((row) => outcomeOf(row) === row.gold);

  return {
    labelAccuracy: ratio(correct.length, rows.length),
    unsafeAllowRate: ratio(
      count((row) => outcomeOf(row) === "allow" && row.gold !== "allow"),
      count((row) => row.gold !== "allow"),
    ),
    approvalRate: ratio(
      count((row) => outcomeOf(row) === "allow" && row.gold === "allow"),
      count((row) => row.gold === "allow"),
    ),
    citationValidity: ratio(
      correct.filter((row) => citationAccepted(row.acceptableCitations, row.run.decision?.citedRowId)).length,
      correct.length,
    ),
    silentAbstention: ratio(
      count((row) => outcomeOf(row) === "abstain" && row.gold === "abstain"),
      count((row) => row.gold === "abstain"),
    ),
    overAbstainRate: ratio(
      count((row) => outcomeOf(row) === "abstain" && row.gold !== "abstain"),
      count((row) => row.gold !== "abstain"),
    ),
  };
}

export function confusionMatrix(rows: ScoredCase[]): ConfusionMatrix {
  const matrix = Object.fromEntries(
    LABELS.map((gold) => [gold, Object.fromEntries(OUTCOME_ORDER.map((outcome) => [outcome, 0]))]),
  ) as ConfusionMatrix;
  for (const row of rows) matrix[row.gold][outcomeOf(row)] += 1;
  return matrix;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values: number[]): number {
  return ratio(values.reduce((sum, value) => sum + value, 0), values.length);
}

export function runStats(rows: ScoredCase[]): RunStats {
  const runs = rows.map((row) => row.run);
  const latencies = runs.map((run) => run.latencyMs);
  return {
    noDecision: runs.filter((run) => run.decision === null).length,
    meanToolCalls: mean(runs.map((run) => run.toolCalls.length)),
    meanModelCalls: mean(runs.map((run) => run.modelCalls)),
    medianLatencyMs: median(latencies),
    maxLatencyMs: Math.max(...latencies),
    inputTokens: runs.reduce((sum, run) => sum + run.inputTokens, 0),
    outputTokens: runs.reduce((sum, run) => sum + run.outputTokens, 0),
  };
}

export function describeCall(call: ToolCall): string {
  const args = Object.values((call.input ?? {}) as Record<string, unknown>).join(", ");
  const result = (call.result ?? {}) as { found?: boolean; candidates?: { id: string }[] };
  if (result.candidates) return `${call.name}(${args}) -> [${result.candidates.map((c) => c.id).join(", ")}]`;
  if (result.found === false) return `${call.name}(${args}) -> not found`;
  return `${call.name}(${args})`;
}

export function percent(value: number): string {
  return Number.isNaN(value) ? "n/a" : `${Math.round(value * 100)}%`;
}

export function formatReport(rows: ScoredCase[]): string {
  const lines: string[] = [];

  lines.push("case  gold         output       cited                      label  cite   ms     tool calls");
  for (const row of rows) {
    const outcome = outcomeOf(row);
    const cited = row.run.decision?.citedRowId ?? row.run.error ?? "";
    const labelMark = outcome === row.gold ? "ok" : outcome === "allow" ? "UNSAFE" : "wrong";
    const citeMark = outcome !== row.gold
      ? "-"
      : citationAccepted(row.acceptableCitations, row.run.decision?.citedRowId) ? "ok" : "wrong";
    lines.push([
      String(row.n).padStart(4),
      row.gold.padEnd(12),
      outcome.padEnd(12),
      cited.slice(0, 26).padEnd(26),
      labelMark.padEnd(6),
      citeMark.padEnd(6),
      String(row.run.latencyMs).padStart(6),
      row.run.toolCalls.map(describeCall).join(" ; "),
    ].join(" "));
  }

  lines.push("", "Confusion matrix (rows are gold labels, columns are outputs)");
  const matrix = confusionMatrix(rows);
  lines.push(["".padEnd(12), ...OUTCOME_ORDER.map((outcome) => outcome.padStart(12))].join(""));
  for (const gold of LABELS) {
    lines.push([gold.padEnd(12), ...OUTCOME_ORDER.map((outcome) => String(matrix[gold][outcome]).padStart(12))].join(""));
  }

  const scores = scoreRuns(rows);
  lines.push(
    "",
    `Label accuracy       ${percent(scores.labelAccuracy)}`,
    `Unsafe-allow rate    ${percent(scores.unsafeAllowRate)}`,
    `Approval rate        ${percent(scores.approvalRate)}`,
    `Citation validity    ${percent(scores.citationValidity)}  (of correct labels)`,
    `Silent abstention    ${percent(scores.silentAbstention)}`,
    `Over-abstain rate    ${percent(scores.overAbstainRate)}`,
  );

  const stats = runStats(rows);
  lines.push(
    "",
    `No decision          ${stats.noDecision}`,
    `Tool calls per case  ${stats.meanToolCalls.toFixed(1)}`,
    `Model calls per case ${stats.meanModelCalls.toFixed(1)}`,
    `Latency median / max ${stats.medianLatencyMs} ms / ${stats.maxLatencyMs} ms`,
    `Tokens in / out      ${stats.inputTokens} / ${stats.outputTokens}`,
  );

  return lines.join("\n");
}
