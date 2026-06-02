import "dotenv/config";

import { ScheduleStore } from "./scheduleStore.js";

const scheduleId = process.argv[2];
const scheduleStore = new ScheduleStore();

if (!scheduleId) {
  const schedules = await scheduleStore.list();
  process.stdout.write(
    schedules.length
      ? `${schedules
          .map(
            (item) =>
              `${item.id} | ${item.status} | ${item.kind} | next=${item.nextRunAt ?? "-"} | runs=${item.totalRuns} | ${item.prompt}`,
          )
          .join("\n")}\n`
      : "No schedules found.\n",
  );
  process.exit(0);
}

const schedule = await scheduleStore.get(scheduleId);
if (!schedule) {
  process.stderr.write(`No schedule found for ${scheduleId}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(schedule, null, 2)}\n`);
