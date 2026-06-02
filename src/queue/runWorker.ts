import "dotenv/config";

import { executeTask } from "../app/executeTask.js";
import { ApprovalStore } from "../workflow/approvalStore.js";
import { executeApprovedRequest } from "../workflow/executeApprovedRequest.js";
import { TaskQueueStore } from "./taskQueue.js";
import type { ProviderName } from "../types/index.js";

const queue = new TaskQueueStore();
const approvalStore = new ApprovalStore();
const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;

const queuedTasks = await queue.list("queued");
if (queuedTasks.length === 0) {
  process.stdout.write("No queued tasks.\n");
  process.exit(0);
}

let task = null as Awaited<ReturnType<TaskQueueStore["claimNextQueued"]>>;

for (let attempt = 0; attempt < queuedTasks.length; attempt += 1) {
  const candidate = await queue.claimNextQueued();
  if (!candidate) {
    break;
  }

  if (!candidate.approvalId) {
    task = candidate;
    break;
  }

  const approval = await approvalStore.get(candidate.approvalId);
  if (!approval) {
    await queue.update(candidate.id, {
      status: "failed",
      error: `Missing approval ${candidate.approvalId}.`,
    });
    continue;
  }

  if (approval.status === "approved") {
    task = candidate;
    break;
  }

  if (approval.status === "rejected") {
    await queue.update(candidate.id, {
      status: "failed",
      error: `Approval ${candidate.approvalId} was rejected.`,
    });
    continue;
  }

  await queue.requeueToBack(candidate.id);
}

if (!task) {
  process.stdout.write("No runnable queued tasks.\n");
  process.exit(0);
}

try {
  const result = task.approvalId
    ? await executeApprovedRequest({
        approvalId: task.approvalId,
        providerName,
        echoStdout: false,
      })
    : await executeTask({
        prompt: task.prompt,
        providerName,
        mode: "default",
        echoStdout: false,
      });

  await queue.update(task.id, {
    status: "completed",
    runId: result.runId,
    logPath: result.logPath ?? undefined,
    resultSummary: result.structuredAnswer.summary,
  });

  process.stdout.write(`Completed task ${task.id}\n`);
  if (result.logPath) {
    process.stdout.write(`Run log: ${result.logPath}\n`);
  }
} catch (error) {
  await queue.update(task.id, {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
  });

  process.stderr.write(`Task ${task.id} failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
