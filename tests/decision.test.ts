import { describe, expect, it } from "vitest";
import { parseDecision } from "../src/decision.js";

describe("parseDecision", () => {
  it("reads a bare JSON decision", () => {
    expect(parseDecision('{"label":"deny","citedRowId":"reg-other-pair"}'))
      .toEqual({ label: "deny", citedRowId: "reg-other-pair" });
  });

  it("reads a decision from prose and code fences", () => {
    const reply = 'Here is my answer.\n```json\n{"label":"needs-owner","citedRowId":" DS-14 "}\n```';
    expect(parseDecision(reply)).toEqual({ label: "needs-owner", citedRowId: "DS-14" });
  });

  it("counts the same decision repeated as one", () => {
    const reply = '{"label":"deny","citedRowId":"reg-other-pair"}\nAgain: {"label":"deny","citedRowId":"reg-other-pair"}';
    expect(parseDecision(reply)).toEqual({ label: "deny", citedRowId: "reg-other-pair" });
  });

  it("refuses a reply that holds two different decisions", () => {
    const reply = 'DS-01: {"label":"allow","citedRowId":"reg-1"}\nDS-14: {"label":"needs-owner","citedRowId":"reg-restricted-raw-curves"}';
    expect(() => parseDecision(reply)).toThrow("more than one decision in the final reply: allow, needs-owner");
  });

  it("accepts an abstain without a citation", () => {
    expect(parseDecision('{"label":"abstain"}')).toEqual({ label: "abstain" });
  });

  it("says why a reply has no decision", () => {
    expect(() => parseDecision("Label: needs-owner")).toThrow("no JSON object in the final reply");
    expect(() => parseDecision('{"label":"Allow"}')).toThrow(/no valid decision[\s\S]*label/);
    expect(() => parseDecision('{"label":"deny","citedRowId":""}')).toThrow(/citedRowId/);
  });
});
