import "dotenv/config";

import { tickSchedulerOnce } from "./tickScheduler.js";

const watchMode = process.argv[2] === "watch";
const watchSeconds = Number(process.argv[3] ?? "30");

if (watchMode && (!Number.isFinite(watchSeconds) || watchSeconds <= 0)) {
  process.stderr.write(`Invalid watch interval seconds: ${process.argv[3]}\n`);
  process.exit(1);
}

if (!watchMode) {
  await tickAndPrint();
  process.exit(0);
}

process.stdout.write(`Scheduler watch mode started; polling every ${watchSeconds}s\n`);
// eslint-disable-next-line no-constant-condition
while (true) {
  await tickAndPrint();
  await sleep(watchSeconds * 1000);
}

async function tickAndPrint(): Promise<void> {
  const results = await tickSchedulerOnce();
  if (results.length === 0) {
    process.stdout.write("No due schedules.\n");
    return;
  }

  for (const item of results) {
    process.stdout.write(`${item.message}\n`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
