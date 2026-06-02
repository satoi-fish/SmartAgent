import "dotenv/config";

import { ApprovalStore } from "../workflow/approvalStore.js";
import { ScheduleStore } from "./scheduleStore.js";

const kind = process.argv[2];
const timingArg = process.argv[3];
const prompt = process.argv[4];
const approvalId = process.argv[5];

if (!kind || !timingArg || !prompt || !["once", "interval"].includes(kind)) {
  process.stderr.write(
    'Usage: npm run schedule:add -- once <iso-datetime> "<prompt>" [approval-id]\n' +
      '   or: npm run schedule:add -- interval <minutes> "<prompt>" [approval-id]\n',
  );
  process.exit(1);
}

if (approvalId) {
  const approvalStore = new ApprovalStore();
  const approval = await approvalStore.get(approvalId);
  if (!approval) {
    process.stderr.write(`No approval request found for ${approvalId}\n`);
    process.exit(1);
  }
}

const scheduleStore = new ScheduleStore();

if (kind === "once") {
  const timestamp = new Date(timingArg);
  if (Number.isNaN(timestamp.getTime())) {
    process.stderr.write(`Invalid ISO datetime: ${timingArg}\n`);
    process.exit(1);
  }

  const schedule = await scheduleStore.create({
    kind: "once",
    prompt,
    runAt: timestamp.toISOString(),
    approvalId,
  });
  process.stdout.write(`Created schedule ${schedule.id} for ${schedule.nextRunAt}\n`);
  process.exit(0);
}

const everyMinutes = Number(timingArg);
if (!Number.isFinite(everyMinutes) || everyMinutes <= 0) {
  process.stderr.write(`Invalid interval minutes: ${timingArg}\n`);
  process.exit(1);
}

const schedule = await scheduleStore.create({
  kind: "interval",
  prompt,
  everyMinutes,
  approvalId,
});
process.stdout.write(`Created schedule ${schedule.id}; next run at ${schedule.nextRunAt}\n`);
