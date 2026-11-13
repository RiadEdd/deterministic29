import { describe, expect, it } from "vitest";
import type { AgentRun } from "../src/agent.js";
import type { Label } from "../src/decision.js";
import { cases } from "../src/cases.js";
import { confusionMatrix, scoreRuns, type ScoredCase } from "../src/score.js";

function run(label: Label | null, citedRowId?: string): AgentRun {
  return {
    decision: label ? { label, citedRowId } : null,
    toolCalls: [],
    modelCalls: 1,
    latencyMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function rows(answer: (testCase: (typeof cases)[number]) => AgentRun): ScoredCase[] {
  return cases.map((testCase) => ({ ...testCase, run: answer(testCase) }));
}

describe("scoring", () => {
  it("gives a perfect agent perfect scores", () => {
    expect(scoreRuns(rows((c) => run(c.gold, c.acceptableCitations[0])))).toEqual({
      labelAccuracy: 1,
      unsafeAllowRate: 0,
      approvalRate: 1,
      citationValidity: 1,
      silentAbstention: 1,
      overAbstainRate: 0,
    });
  });

  it("does not let an agent that always denies look safe and useful", () => {
    const scores = scoreRuns(rows((c) => run("deny", c.acceptableCitations[0])));
    expect(scores.unsafeAllowRate).toBe(0);
    expect(scores.approvalRate).toBe(0);
  });

  it("counts every allow on a non-allow case as unsafe", () => {
    expect(scoreRuns(rows((c) => run("allow", c.acceptableCitations[0]))).unsafeAllowRate).toBe(1);
  });

  it("fails made-up and missing citations, and ignores case on accepted ones", () => {
    expect(scoreRuns(rows((c) => run(c.gold, "rule-7b"))).citationValidity).toBe(0);
    expect(scoreRuns(rows((c) => run(c.gold))).citationValidity).toBe(0);
    expect(scoreRuns(rows((c) => run(c.gold, c.acceptableCitations[0].toUpperCase()))).citationValidity).toBe(1);
  });

  it("puts runs without a decision in the none column", () => {
    const matrix = confusionMatrix(rows(() => run(null)));
    expect(matrix.allow.none + matrix.deny.none + matrix["needs-owner"].none + matrix.abstain.none).toBe(cases.length);
  });

  it("has one gold label and at least one acceptable citation per case", () => {
    expect(new Set(cases.map((c) => c.n)).size).toBe(cases.length);
    for (const testCase of cases) expect(testCase.acceptableCitations.length).toBeGreaterThan(0);
  });
});
