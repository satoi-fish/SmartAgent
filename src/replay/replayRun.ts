import "dotenv/config";

import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

interface StoredRun {
  runId: string;
  startedAt: string;
  completedAt: string;
  summary: {
    prompt: string;
    answer: string;
    toolCalls: string[];
    totalTokens: number;
    needsHumanReview: boolean;
    model: string;
    provider: string;
  };
  events: Array<{
    timestamp: string;
    event: { type: string; [key: string]: unknown };
  }>;
}

async function resolveRunPath(input: string): Promise<string> {
  const candidate = input.endsWith(".json") ? input : `${input}.json`;

  if (candidate.startsWith("/") || candidate.startsWith(".")) {
    return resolve(candidate);
  }

  const logDir = resolve(process.cwd(), ".agent-runs");
  const files = await readdir(logDir);
  const match = files.find((file) => file === candidate || file.includes(input));

  if (!match) {
    throw new Error(`Could not find a run matching "${input}" in ${logDir}`);
  }

  return resolve(logDir, match);
}

const requested = process.argv[2];
if (!requested) {
  process.stderr.write('Usage: npm run replay -- <run-id-or-log-path>\n');
  process.exit(1);
}

const runPath = await resolveRunPath(requested);
const run = JSON.parse(await readFile(runPath, "utf8")) as StoredRun;

const toolSequence = run.summary.toolCalls.length ? run.summary.toolCalls.join(" -> ") : "none";
const statusCounts = run.events
  .filter((entry) => entry.event.type === "tool_status")
  .reduce<Record<string, number>>((acc, entry) => {
    const key = String(entry.event.status ?? "unknown");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

process.stdout.write(
  [
    `Run: ${run.runId}`,
    `Log file: ${runPath}`,
    `Started: ${run.startedAt}`,
    `Completed: ${run.completedAt}`,
    `Provider/Model: ${run.summary.provider} / ${run.summary.model}`,
    `Tokens: ${run.summary.totalTokens}`,
    `Needs human review: ${run.summary.needsHumanReview ? "yes" : "no"}`,
    `Tool sequence: ${toolSequence}`,
    `Tool status counts: ${JSON.stringify(statusCounts)}`,
    `Prompt:\n${run.summary.prompt}`,
    `Answer:\n${run.summary.answer}`,
  ].join("\n\n"),
);

process.stdout.write(`\n\nReplay source: ${basename(runPath)}\n`);
