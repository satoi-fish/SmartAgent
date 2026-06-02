import "dotenv/config";

import { executeTask } from "../app/executeTask.js";
import type { ApprovalMode, ProviderName } from "../types/index.js";

const [prompt, ...filePaths] = process.argv.slice(2);

if (!prompt) {
  process.stderr.write('Usage: npm run multimodal -- "<prompt>" <file1> <file2> ...\n');
  process.exit(1);
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const mode = (process.env.AGENT_MODE ?? "default") as ApprovalMode;

const result = await executeTask({
  prompt,
  providerName,
  mode,
  attachmentPaths: filePaths,
  echoStdout: true,
  persistSession: true,
});

process.stdout.write(`\nMultimodal answer:\n${result.renderedAnswer}\n`);
process.stdout.write(`\nRun log: ${result.logPath}\n`);
