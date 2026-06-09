import "dotenv/config";

import type { ProviderName } from "../types/index.js";
import { createApprovalRequestFromPrompt } from "./createApprovalRequest.js";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  process.stderr.write('Usage: npm run plan -- "your task here"\n');
  process.exit(1);
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const request = await createApprovalRequestFromPrompt({
  prompt,
  providerName,
});

process.stdout.write(
  [
    `Approval request: ${request.id}`,
    `Status: ${request.status}`,
    `Summary: ${request.plan.summary}`,
    `Suggested mode: ${request.plan.suggestedMode}`,
    `Goals:\n${request.plan.goals.map((goal) => `- ${goal}`).join("\n")}`,
    `Steps:\n${request.plan.steps
      .map((step, index) => `${index + 1}. [${step.kind}] ${step.title} (${step.requiresApproval ? "approval" : "safe"})\n   ${step.detail}`)
      .join("\n")}`,
    `Risks:\n${request.plan.risks.length ? request.plan.risks.map((risk) => `- ${risk}`).join("\n") : "- none"}`,
    `Approvals needed:\n${
      request.plan.approvalsNeeded.length
        ? request.plan.approvalsNeeded.map((item) => `- ${item}`).join("\n")
        : "- none"
    }`,
    `Approved tools:\n${
      request.plan.approvedTools.length
        ? request.plan.approvedTools.map((item) => `- ${item}`).join("\n")
        : "- none"
    }`,
  ].join("\n\n"),
);
