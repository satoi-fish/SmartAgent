import { executeTask } from "../app/executeTask.js";
import type { ProviderName } from "../types/index.js";
import { ApprovalStore } from "../workflow/approvalStore.js";
import { executeApprovedRequest } from "../workflow/executeApprovedRequest.js";
import { TaskQueueStore } from "./taskQueue.js";

export interface ProcessNextTaskResult {
  status: "completed" | "skipped" | "failed";
  message: string;
  taskId?: string;
  runId?: string;
  logPath?: string;
}

export async function processNextQueuedTask(args: {
  providerName: ProviderName;
}): Promise<ProcessNextTaskResult> {
  const queue = new TaskQueueStore();
  const approvalStore = new ApprovalStore();

  const queuedTasks = await queue.list("queued");
  if (queuedTasks.length === 0) {
    return {
      status: "skipped",
      message: "No queued tasks.",
    };
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
    return {
      status: "skipped",
      message: "No runnable queued tasks.",
    };
  }

  try {
    const result = task.approvalId
      ? await executeApprovedRequest({
          approvalId: task.approvalId,
          providerName: args.providerName,
          echoStdout: false,
        })
      : await executeTask({
          prompt: task.prompt,
          providerName: args.providerName,
          mode: "default",
          echoStdout: false,
        });

    await queue.update(task.id, {
      status: "completed",
      runId: result.runId,
      logPath: result.logPath ?? undefined,
      resultSummary: result.structuredAnswer.summary,
    });

    return {
      status: "completed",
      message: `Completed task ${task.id}`,
      taskId: task.id,
      runId: result.runId,
      logPath: result.logPath ?? undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await queue.update(task.id, {
      status: "failed",
      error: message,
    });

    return {
      status: "failed",
      message: `Task ${task.id} failed: ${message}`,
      taskId: task.id,
    };
  }
}
