import { ApprovalStore } from "../workflow/approvalStore.js";
import { TaskQueueStore } from "../queue/taskQueue.js";
import { ScheduleStore } from "./scheduleStore.js";

export interface SchedulerTickItem {
  scheduleId: string;
  status: "queued" | "waiting_approval" | "error";
  taskId?: string;
  message: string;
}

export async function tickSchedulerOnce(): Promise<SchedulerTickItem[]> {
  const scheduleStore = new ScheduleStore();
  const taskQueue = new TaskQueueStore();
  const approvalStore = new ApprovalStore();
  const claimedSchedules = await scheduleStore.claimDue();

  if (claimedSchedules.length === 0) {
    return [];
  }

  const results: SchedulerTickItem[] = [];

  for (const claimed of claimedSchedules) {
    const schedule = claimed.schedule;
    if (schedule.approvalId) {
      const approval = await approvalStore.get(schedule.approvalId);
      if (!approval || approval.status !== "approved") {
        await scheduleStore.releaseClaim({
          scheduleId: schedule.id,
          claimId: claimed.claimId,
        });
        results.push({
          scheduleId: schedule.id,
          status: "waiting_approval",
          message: `Schedule ${schedule.id} is waiting on approval ${schedule.approvalId}.`,
        });
        continue;
      }
    }

    try {
      const task = await taskQueue.enqueue({
        prompt: schedule.prompt,
        approvalId: schedule.approvalId,
        scheduleId: schedule.id,
        trigger: "schedule",
      });

      await scheduleStore.markTriggered({
        scheduleId: schedule.id,
        taskId: task.id,
        claimId: claimed.claimId,
      });

      results.push({
        scheduleId: schedule.id,
        status: "queued",
        taskId: task.id,
        message: `Triggered ${schedule.id} -> queued ${task.id}`,
      });
    } catch (error) {
      await scheduleStore.releaseClaim({
        scheduleId: schedule.id,
        claimId: claimed.claimId,
      });
      results.push({
        scheduleId: schedule.id,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
