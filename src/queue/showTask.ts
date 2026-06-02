import "dotenv/config";

import { TaskQueueStore } from "./taskQueue.js";

const taskId = process.argv[2];
const queue = new TaskQueueStore();

if (!taskId) {
  const tasks = await queue.list();
  process.stdout.write(
    tasks.length
      ? `${tasks
          .map(
            (task) =>
              `${task.id} | ${task.status} | trigger=${task.trigger} | ${task.updatedAt} | ${task.prompt}`,
          )
          .join("\n")}\n`
      : "No tasks found.\n",
  );
  process.exit(0);
}

const task = await queue.get(taskId);
if (!task) {
  process.stderr.write(`No task found for ${taskId}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify(task, null, 2)}\n`);
