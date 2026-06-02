import "dotenv/config";

import { ApprovalStore } from "../workflow/approvalStore.js";
import { TaskQueueStore } from "./taskQueue.js";

const prompt = process.argv[2];
const approvalId = process.argv[3];

if (!prompt) {
  process.stderr.write('Usage: npm run enqueue -- "<prompt>" [approval-id]\n');
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

const queue = new TaskQueueStore();
const task = await queue.enqueue({
  prompt,
  approvalId,
  trigger: "manual",
});

process.stdout.write(`Enqueued task ${task.id}\n`);
