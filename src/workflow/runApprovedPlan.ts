import "dotenv/config";

import type { ProviderName } from "../types/index.js";
import { executeApprovedRequest } from "./executeApprovedRequest.js";

const approvalId = process.argv[2];
if (!approvalId) {
  process.stderr.write("Usage: npm run execute-approved -- <approval-id>\n");
  process.exit(1);
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const result = await executeApprovedRequest({
  approvalId,
  providerName,
  echoStdout: true,
});

process.stdout.write(`\nExecuted approval ${approvalId}\n`);
if (result.logPath) {
  process.stdout.write(`Run log: ${result.logPath}\n`);
}
