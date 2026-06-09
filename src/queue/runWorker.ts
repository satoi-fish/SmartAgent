import "dotenv/config";

import type { ProviderName } from "../types/index.js";
import { processNextQueuedTask } from "./processNextTask.js";

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const result = await processNextQueuedTask({
  providerName,
});

if (result.status === "completed") {
  process.stdout.write(`${result.message}\n`);
  if (result.logPath) {
    process.stdout.write(`Run log: ${result.logPath}\n`);
  }
  process.exit(0);
}

if (result.status === "skipped") {
  process.stdout.write(`${result.message}\n`);
  process.exit(0);
}

process.stderr.write(`${result.message}\n`);
process.exit(1);
