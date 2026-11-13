import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { decide, type AgentRun } from "./agent.js";
import { CASE_SETS, type CaseSet } from "./cases.js";
import { llmFor } from "./llm/index.js";
import { writeReports, type RunRecord } from "./report.js";
import { confusionMatrix, formatReport, runStats, scoreRuns, type ScoredCase } from "./score.js";
import { VARIANTS, type Variant } from "./variants.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RESULTS_DIR = join(ROOT, "results");

const { values } = parseArgs({
  options: {
    variant: { type: "string", multiple: true },
    runs: { type: "string", default: "1" },
    set: { type: "string", default: "core" },
    "report-only": { type: "boolean", default: false },
  },
});

type Setup = {
  modelId: string;
  temperature?: number;
  maxTurns?: number;
  promptFile: string;
  systemPrompt: string;
  decide: (request: string) => Promise<AgentRun>;
};

function setupFor(variant: Variant): Setup {
  if (variant.kind === "script") {
    return {
      modelId: "none",
      promptFile: variant.sourceFile,
      systemPrompt: readFileSync(join(ROOT, variant.sourceFile), "utf8"),
      decide: async (request) => variant.decide(request),
    };
  }
  const systemPrompt = readFileSync(join(ROOT, variant.promptFile), "utf8");
  const llm = llmFor(variant.llm);
  const config = { systemPrompt, llm, temperature: variant.temperature, maxTurns: variant.maxTurns };
  return {
    modelId: llm.id,
    temperature: variant.temperature,
    maxTurns: variant.maxTurns,
    promptFile: variant.promptFile,
    systemPrompt,
    decide: (request) => decide(request, config),
  };
}

async function runVariant(variant: Variant, caseSet: CaseSet, batchId: string, runNumber: number): Promise<RunRecord> {
  const setup = setupFor(variant);
  const startedAt = new Date().toISOString();
  const rows: ScoredCase[] = [];

  for (const testCase of CASE_SETS[caseSet]) {
    const run = await setup.decide(testCase.request);
    rows.push({ ...testCase, run });
    process.stdout.write(`  case ${testCase.n}: ${run.decision?.label ?? "no decision"}\n`);
  }

  return {
    batchId,
    caseSet,
    variant: variant.name,
    description: variant.description,
    modelId: setup.modelId,
    temperature: setup.temperature,
    maxTurns: setup.maxTurns,
    promptFile: setup.promptFile,
    promptSha: createHash("sha256").update(setup.systemPrompt).digest("hex").slice(0, 8),
    systemPrompt: setup.systemPrompt,
    run: runNumber,
    startedAt,
    finishedAt: new Date().toISOString(),
    cases: rows,
    scores: scoreRuns(rows),
    confusion: confusionMatrix(rows),
    stats: runStats(rows),
  };
}

function pickVariants(names: string[] | undefined): Variant[] {
  if (!names || names.length === 0) return VARIANTS.filter((variant) => !variant.optional);
  const wanted = names.flatMap((name) => name.split(","));
  const unknown = wanted.filter((name) => !VARIANTS.some((variant) => variant.name === name));
  if (unknown.length > 0) {
    throw new Error(`Unknown variant: ${unknown.join(", ")}. Known: ${VARIANTS.map((v) => v.name).join(", ")}`);
  }
  return VARIANTS.filter((variant) => wanted.includes(variant.name));
}

async function main(): Promise<void> {
  if (values["report-only"]) {
    writeReports(RESULTS_DIR);
    console.log(`Reports rebuilt: ${join(RESULTS_DIR, "index.html")}`);
    return;
  }

  const runs = Number.parseInt(values.runs ?? "1", 10);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  const variants = pickVariants(values.variant);
  const caseSet = values.set as CaseSet;
  if (!(caseSet in CASE_SETS)) throw new Error(`--set must be one of: ${Object.keys(CASE_SETS).join(", ")}`);

  const batchId = `batch-${randomUUID().slice(0, 8)}`;
  const batchDir = join(RESULTS_DIR, batchId);
  mkdirSync(batchDir, { recursive: true });

  for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
    for (const variant of variants) {
      console.log(`\n${variant.name}, run ${runNumber} of ${runs}`);
      const record = await runVariant(variant, caseSet, batchId, runNumber);
      writeFileSync(join(batchDir, `${variant.name}.run-${runNumber}.json`), `${JSON.stringify(record, null, 2)}\n`);
      writeReports(RESULTS_DIR);
      console.log(`\n${formatReport(record.cases)}`);
    }
  }

  console.log(`\nReport: ${join(batchDir, "report.html")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
