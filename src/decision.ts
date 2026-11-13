import { z } from "zod";

export const LABELS = ["allow", "deny", "needs-owner", "abstain"] as const;

export const LabelSchema = z.enum(LABELS);

export type Label = z.infer<typeof LabelSchema>;

export const DecisionSchema = z.object({
  label: LabelSchema,
  citedRowId: z.string().trim().min(1).optional(),
});

export type Decision = z.infer<typeof DecisionSchema>;

// Accepts one decision, including when it is wrapped in prose or a code fence.
// The same decision repeated counts once. Two different decisions are no decision:
// picking either one would let the parser choose the label.
export function parseDecision(text: string): Decision {
  const candidates = text.match(/\{[^{}]*\}/g) ?? [];
  if (candidates.length === 0) throw new Error("no JSON object in the final reply");

  const decisions = new Map<string, Decision>();
  let lastError = "";
  for (const raw of candidates) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      lastError = `not valid JSON: ${raw}`;
      continue;
    }
    const result = DecisionSchema.safeParse(json);
    if (result.success) decisions.set(JSON.stringify(result.data), result.data);
    else lastError = z.prettifyError(result.error);
  }

  if (decisions.size > 1) {
    const labels = [...decisions.values()].map((decision) => decision.label).join(", ");
    throw new Error(`more than one decision in the final reply: ${labels}`);
  }
  const [decision] = decisions.values();
  if (decision) return decision;
  throw new Error(`no valid decision in the final reply: ${lastError}`);
}
