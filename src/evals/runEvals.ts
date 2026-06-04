import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { executeTask } from "../app/executeTask.js";
import type { ApprovalMode, ProviderName } from "../types/index.js";

interface EvalCase {
  id: string;
  prompt: string;
  mode?: ApprovalMode;
  must_include: string[];
  expected_citations?: string[];
  needs_human_review?: boolean;
  max_tool_calls?: number;
}

interface EvalResult {
  id: string;
  passed: boolean;
  score: number;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  runId: string;
  logPath: string | null;
  renderedAnswer: string;
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const casesPath = resolve(process.cwd(), "evals", "cases.json");
const reportsDir = resolve(process.cwd(), "evals", "reports");
const rawCases = await readFile(casesPath, "utf8");
const cases = JSON.parse(rawCases) as EvalCase[];
const results: EvalResult[] = [];

for (const evalCase of cases) {
  process.stdout.write(`Running eval ${evalCase.id}...\n`);

  const run = await executeTask({
    prompt: evalCase.prompt,
    providerName,
    mode: evalCase.mode ?? "default",
    echoStdout: false,
    persistSession: false,
    persistRunLog: true,
    sessionFilePath: resolve(process.cwd(), ".agent-session.evals.json"),
  });

  const combinedText = [
    run.structuredAnswer.summary,
    run.structuredAnswer.answer,
    ...run.structuredAnswer.risks,
    ...run.structuredAnswer.next_steps,
    ...run.structuredAnswer.citations,
  ]
    .join("\n")
    .toLowerCase();

  const checks: EvalResult["checks"] = [];

  for (const phrase of evalCase.must_include) {
    const passed = combinedText.includes(phrase.toLowerCase());
    checks.push({
      name: `must_include:${phrase}`,
      passed,
      detail: passed ? "Found in structured answer." : "Missing from structured answer.",
    });
  }

  for (const citation of evalCase.expected_citations ?? []) {
    const passed = run.structuredAnswer.citations.some((item) =>
      item.toLowerCase().includes(citation.toLowerCase()),
    );
    checks.push({
      name: `citation:${citation}`,
      passed,
      detail: passed ? "Citation present." : "Expected citation missing.",
    });
  }

  if (typeof evalCase.needs_human_review === "boolean") {
    const passed = run.structuredAnswer.needs_human_review === evalCase.needs_human_review;
    checks.push({
      name: "needs_human_review",
      passed,
      detail: `Expected ${evalCase.needs_human_review}, got ${run.structuredAnswer.needs_human_review}.`,
    });
  }

  if (typeof evalCase.max_tool_calls === "number") {
    const passed = run.toolCalls.length <= evalCase.max_tool_calls;
    checks.push({
      name: "max_tool_calls",
      passed,
      detail: `Used ${run.toolCalls.length} tool calls, limit ${evalCase.max_tool_calls}.`,
    });
  }

  const passedChecks = checks.filter((check) => check.passed).length;
  const score = checks.length === 0 ? 1 : passedChecks / checks.length;

  results.push({
    id: evalCase.id,
    passed: checks.every((check) => check.passed),
    score,
    checks,
    runId: run.runId,
    logPath: run.logPath,
    renderedAnswer: run.renderedAnswer,
  });
}

await mkdir(reportsDir, { recursive: true });

const summary = {
  executedAt: new Date().toISOString(),
  totalCases: results.length,
  passedCases: results.filter((result) => result.passed).length,
  averageScore:
    results.reduce((acc, result) => acc + result.score, 0) / (results.length || 1),
  results,
};

const reportPath = resolve(
  reportsDir,
  `eval-summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

process.stdout.write(`\nSaved eval report to ${reportPath}\n`);
