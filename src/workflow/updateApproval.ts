import "dotenv/config";

import { ApprovalStore } from "./approvalStore.js";
import type { ApprovalStatus } from "../types/index.js";

const approvalId = process.argv[2];
const action = (process.argv[3] ?? "approved") as ApprovalStatus;

if (!approvalId) {
  process.stderr.write("Usage: npm run approve -- <approval-id> [approved|rejected]\n");
  process.exit(1);
}

if (!["approved", "rejected", "pending"].includes(action)) {
  process.stderr.write("Status must be one of: approved, rejected, pending\n");
  process.exit(1);
}

const store = new ApprovalStore();
const updated = await store.updateStatus(approvalId, action);

if (!updated) {
  process.stderr.write(`No approval request found for ${approvalId}\n`);
  process.exit(1);
}

process.stdout.write(
  [
    `Approval request: ${updated.id}`,
    `Status: ${updated.status}`,
    `Updated at: ${updated.updatedAt}`,
    `Summary: ${updated.plan.summary}`,
  ].join("\n"),
);
