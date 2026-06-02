import "dotenv/config";

import { executeTask } from "./app/executeTask.js";
import type { ApprovalMode, ProviderName } from "./types/index.js";

const prompt = process.argv.slice(2).join(" ").trim();

if (!prompt) {
  process.stderr.write('Usage: npm run dev -- "your task here"\n');
  process.exit(1);
}

const mode = (process.env.AGENT_MODE ?? "default") as ApprovalMode;
const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;

const result = await executeTask({
  prompt,
  providerName,
  mode,
  echoStdout: true,
  persistSession: true,
});

process.stdout.write(`\nFinal answer:\n${result.renderedAnswer}\n`);
process.stdout.write(`\nRun log: ${result.logPath}\n`);
