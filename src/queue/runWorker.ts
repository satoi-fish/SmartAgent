import "dotenv/config";

import { executeTask } from "../app/executeTask.js";
import { ApprovalStore } from "../workflow/approvalStore.js";
import { TaskQueueStore } from "./taskQueue.js";
import type { ProviderName } from "../types/index.js";

const queue = new TaskQueueStore();
const approvalStore = new ApprovalStore();
const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;

const task = await queue.nextQueued();
if (!task) {
  process.stdout.write("No queued tasks.\n");
  process.exit(0);
}

if (task.approvalId) {
  const approval = await approvalStore.get(task.approvalId);
  if (!approval || approval.status !== "approved") {
    process.stdout.write(`Task ${task.id} is waiting on approval ${task.approvalId}.\n`);
    process.exit(0);
  }
}

await queue.update(task.id, {
  status: "running",
});

try {
  const result = await executeTask({
    prompt: task.prompt,
    providerName,
    mode: "default",
    echoStdout: false,
    persistSession: true,
  });

  await queue.update(task.id, {
    status: "completed",
    runId: result.runId,
    logPath: result.logPath,
    resultSummary: result.structuredAnswer.summary,
  });

  process.stdout.write(`Completed task ${task.id}\nRun log: ${result.logPath}\n`);
} catch (error) {
  await queue.update(task.id, {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  });

  process.stderr.write(`Task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
