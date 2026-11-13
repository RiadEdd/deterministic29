# Data release clearance agent

Take-home for the AI71 PM role. An LLM in a tool loop decides whether one dataset may be sent to one destination, and an eval scores it on 20 core cases and 8 adversarial cases, against a no-model script as the control.

## Read first

1. `docs/executive-summary.html`: findings, results and recommendations.
2. `docs/reflection.html`: what I learned, and the one-week and one-month plans.
3. `docs/technical-documentation.html`: how it is built, how it was tested, the policy and the cases.
4. `results/index.html`: open in a browser. Every run, with tool calls and the model's final reply.

## Layout

| Path | What it holds |
| --- | --- |
| `src/agent.ts` | The tool loop. |
| `src/tools.ts` | Four read-only tools over the records in `data/`. |
| `src/decision.ts` | The output schema and parser. |
| `src/cases.ts` | The 20 core cases and the 8 adversarial cases, with gold labels and acceptable citations. |
| `src/score.ts` | The metrics. |
| `src/variants.ts` | The variants: prompt, model, temperature, and the no-model script. |
| `src/rules-only.ts` | The no-model variant: the rulebook applied by code to ids and names read from the request. |
| `src/llm/` | Model providers: AWS Bedrock and Ollama. |
| `prompts/` | One prompt file per variant. |
| `results/` | One folder per batch: a JSON file per run, and `report.html`. |
| `tests/` | Unit tests for the tools, the parser and the scorer. |

## Run

Tested on Node 25 with pnpm 10. The Bedrock variants need AWS credentials with access to Claude Sonnet 4.6 and gpt-oss-20b.

```sh
pnpm install
pnpm test

# All Bedrock variants, three runs each.
AWS_PROFILE=<your profile> pnpm eval --runs 3

# One variant.
AWS_PROFILE=<your profile> pnpm eval --variant procedure --runs 3

# The adversarial set instead of the 20 core cases.
AWS_PROFILE=<your profile> pnpm eval --set adversarial --runs 3

# The no-model script only. Needs no credentials.
pnpm eval --variant rules-only

# gpt-oss-20b on this machine. Needs `ollama serve` and `ollama pull gpt-oss:20b`.
pnpm eval --variant procedure-local

# Rebuild the HTML reports from the run files.
pnpm report
```

`AWS_REGION` defaults to `us-east-1`. `OLLAMA_URL` defaults to `http://localhost:11434`.

Each eval writes `results/<batch id>/<variant>.run-<n>.json` and rebuilds `report.html` for the batch and `results/index.html`.

## Batches in `results/`

| Batch | Variants | Runs each |
| --- | --- | --- |
| `1-core` | `baseline`, `procedure`, `procedure-gpt-oss` | 3 |
| `2-core-rulebook` | `rulebook` | 3 |
| `3-core-rerun` | `baseline` and `rules-only`, core set, after the parser change | 3 |
| `4-adversarial` | all Bedrock variants and `rules-only`, adversarial set | 3 |

The first two batches were scored with the earlier parser, which kept the last decision when a reply held two. Their run files are left as recorded. A reply with two different decisions is now no decision. Re-parsing the stored replies changes only four baseline runs (case 19 once, case 20 three times), from `needs-owner` to no decision.
