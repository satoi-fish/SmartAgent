import "dotenv/config";

import { ApprovalStore } from "../workflow/approvalStore.js";
import { TaskQueueStore } from "../queue/taskQueue.js";
import { ScheduleStore } from "./scheduleStore.js";

const watchMode = process.argv[2] === "watch";
const watchSeconds = Number(process.argv[3] ?? "30");

if (watchMode && (!Number.isFinite(watchSeconds) || watchSeconds <= 0)) {
  process.stderr.write(`Invalid watch interval seconds: ${process.argv[3]}\n`);
  process.exit(1);
}

const scheduleStore = new ScheduleStore();
const taskQueue = new TaskQueueStore();
const approvalStore = new ApprovalStore();

if (!watchMode) {
  await tick();
  process.exit(0);
}

process.stdout.write(`Scheduler watch mode started; polling every ${watchSeconds}s\n`);
// eslint-disable-next-line no-constant-condition
while (true) {
  await tick();
  await sleep(watchSeconds * 1000);
}

async function tick(): Promise<void> {
  const dueSchedules = await scheduleStore.listDue();
  if (dueSchedules.length === 0) {
    process.stdout.write("No due schedules.\n");
    return;
  }

  for (const schedule of dueSchedules) {
    if (schedule.approvalId) {
      const approval = await approvalStore.get(schedule.approvalId);
      if (!approval || approval.status !== "approved") {
        process.stdout.write(
          `Schedule ${schedule.id} is waiting on approval ${schedule.approvalId}; skipped for now.\n`,
        );
        continue;
      }
    }

    const task = await taskQueue.enqueue({
      prompt: schedule.prompt,
      approvalId: schedule.approvalId,
      scheduleId: schedule.id,
      trigger: "schedule",
    });

    await scheduleStore.markTriggered({
      scheduleId: schedule.id,
      taskId: task.id,
    });

    process.stdout.write(`Triggered ${schedule.id} -> queued ${task.id}\n`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
