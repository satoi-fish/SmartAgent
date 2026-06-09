import { executeTask } from "../app/executeTask.js";
import { GitRepositoryService } from "../integrations/git/repository.js";
import { TaskQueueStore } from "../queue/taskQueue.js";
import { processNextQueuedTask } from "../queue/processNextTask.js";
import { ScheduleStore } from "../scheduler/scheduleStore.js";
import { tickSchedulerOnce } from "../scheduler/tickScheduler.js";
import type { ApprovalStatus, ProviderName, TeamMode } from "../types/index.js";
import { ApprovalStore } from "../workflow/approvalStore.js";
import { createApprovalRequestFromPrompt } from "../workflow/createApprovalRequest.js";
import { executeApprovedRequest } from "../workflow/executeApprovedRequest.js";
import type {
  WorkbenchOperationsState,
  WorkbenchRepositoryState,
} from "./types.js";

const gitRepository = new GitRepositoryService(process.env.AGENT_WORKSPACE_ROOT);

export async function loadOperationsState(): Promise<WorkbenchOperationsState> {
  const approvalStore = new ApprovalStore();
  const taskQueue = new TaskQueueStore();
  const scheduleStore = new ScheduleStore();

  const [approvals, tasks, schedules, repository] = await Promise.all([
    approvalStore.list(),
    taskQueue.list(),
    scheduleStore.list(),
    safeLoadRepositoryState(),
  ]);

  return {
    approvals: approvals
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20)
      .map((item) => ({
        id: item.id,
        prompt: item.prompt,
        status: item.status,
        updatedAt: item.updatedAt,
        summary: item.plan.summary,
      })),
    tasks: tasks
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20)
      .map((item) => ({
        id: item.id,
        prompt: item.prompt,
        status: item.status,
        trigger: item.trigger,
        updatedAt: item.updatedAt,
        approvalId: item.approvalId,
        scheduleId: item.scheduleId,
        runId: item.runId,
        error: item.error,
      })),
    schedules: schedules
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 20)
      .map((item) => ({
        id: item.id,
        prompt: item.prompt,
        status: item.status,
        kind: item.kind,
        nextRunAt: item.nextRunAt,
        updatedAt: item.updatedAt,
        approvalId: item.approvalId,
        totalRuns: item.totalRuns,
      })),
    repository,
  };
}

export async function runInteractiveTask(args: {
  prompt: string;
  providerName: ProviderName;
  mode?: "default" | "plan" | "auto";
  teamMode?: TeamMode;
}): Promise<{
  runId: string;
  logPath: string | null;
  summary: string;
  needsHumanReview: boolean;
}> {
  const result = await executeTask({
    prompt: args.prompt,
    providerName: args.providerName,
    mode: args.mode ?? "default",
    teamMode: args.teamMode,
    echoStdout: false,
    persistRunLog: true,
  });

  return {
    runId: result.runId,
    logPath: result.logPath,
    summary: result.structuredAnswer.summary,
    needsHumanReview: result.structuredAnswer.needs_human_review,
  };
}

export async function createInteractivePlan(args: {
  prompt: string;
  providerName: ProviderName;
}) {
  return await createApprovalRequestFromPrompt({
    prompt: args.prompt,
    providerName: args.providerName,
  });
}

export async function updateInteractiveApproval(args: {
  approvalId: string;
  status: ApprovalStatus;
}) {
  const store = new ApprovalStore();
  return await store.updateStatus(args.approvalId, args.status);
}

export async function executeInteractiveApproval(args: {
  approvalId: string;
  providerName: ProviderName;
}) {
  return await executeApprovedRequest({
    approvalId: args.approvalId,
    providerName: args.providerName,
    echoStdout: false,
    persistRunLog: true,
  });
}

export async function enqueueInteractiveTask(args: {
  prompt: string;
  approvalId?: string;
}) {
  const queue = new TaskQueueStore();
  return await queue.enqueue({
    prompt: args.prompt,
    approvalId: args.approvalId,
    trigger: "manual",
  });
}

export async function createInteractiveSchedule(args: {
  prompt: string;
  kind: "once" | "interval";
  runAt?: string;
  everyMinutes?: number;
  approvalId?: string;
}) {
  const scheduleStore = new ScheduleStore();
  return await scheduleStore.create({
    prompt: args.prompt,
    kind: args.kind,
    runAt: args.runAt,
    everyMinutes: args.everyMinutes,
    approvalId: args.approvalId,
  });
}

export async function tickInteractiveWorker(args: { providerName: ProviderName }) {
  return await processNextQueuedTask({
    providerName: args.providerName,
  });
}

export async function tickInteractiveScheduler() {
  return await tickSchedulerOnce();
}

async function safeLoadRepositoryState(): Promise<WorkbenchRepositoryState | null> {
  try {
    const summary = await gitRepository.getSummary(".");
    return {
      branch: summary.branch,
      ahead: summary.ahead,
      behind: summary.behind,
      isClean: summary.isClean,
      changedFiles: summary.changedFiles.slice(0, 20),
    };
  } catch {
    return null;
  }
}
