import "dotenv/config";

import { executeTask } from "../app/executeTask.js";
import type { ApprovalMode, ProviderName } from "../types/index.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  process.stderr.write('Usage: npm run team -- "your task here"\n');
  process.exit(1);
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const mode = (process.env.AGENT_MODE ?? "default") as ApprovalMode;

const result = await executeTask({
  prompt,
  providerName,
  mode,
  teamMode: "planner_reviewer",
  echoStdout: true,
});

process.stdout.write(`\nTeam-mode answer:\n${result.renderedAnswer}\n`);
if (result.logPath) {
  process.stdout.write(`\nRun log: ${result.logPath}\n`);
}
