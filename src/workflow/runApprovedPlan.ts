import "dotenv/config";

import { executeTask } from "../app/executeTask.js";
import { ApprovalStore } from "./approvalStore.js";
import type { ApprovalMode, ProviderName } from "../types/index.js";

const approvalId = process.argv[2];
if (!approvalId) {
  process.stderr.write("Usage: npm run execute-approved -- <approval-id>\n");
  process.exit(1);
}

const store = new ApprovalStore();
const request = await store.get(approvalId);
if (!request) {
  process.stderr.write(`No approval request found for ${approvalId}\n`);
  process.exit(1);
}

if (request.status !== "approved") {
  process.stderr.write(`Approval request ${approvalId} is ${request.status}, not approved.\n`);
  process.exit(1);
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const mode = ((request.plan.suggestedMode === "plan" ? "default" : request.plan.suggestedMode) ??
  "default") as ApprovalMode;

const result = await executeTask({
  prompt: request.prompt,
  providerName,
  mode,
  echoStdout: true,
  persistSession: true,
});

process.stdout.write(`\nExecuted approval ${approvalId}\nRun log: ${result.logPath}\n`);
