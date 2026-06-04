import { executeTask } from "../app/executeTask.js";
import type { ExecuteTaskResult } from "../app/executeTask.js";
import { loadPermissionPolicy } from "../tools/policy.js";
import { ApprovalStore } from "./approvalStore.js";
import type { ProviderName } from "../types/index.js";

function buildApprovedExecutionPrompt(args: {
  prompt: string;
  approvalId: string;
  summary: string;
  goals: string[];
  approvedTools: string[];
}): string {
  return [
    args.prompt,
    "",
    `Approved execution context (${args.approvalId}):`,
    `- Plan summary: ${args.summary}`,
    ...args.goals.map((goal) => `- Goal: ${goal}`),
    `- Approved tools: ${args.approvedTools.length ? args.approvedTools.join(", ") : "none"}`,
    "- Stay within the approved plan. If a different approval-gated action is needed, stop and explain what new approval is required.",
  ].join("\n");
}

export async function executeApprovedRequest(args: {
  approvalId: string;
  providerName: ProviderName;
  echoStdout?: boolean;
  persistSession?: boolean;
  persistRunLog?: boolean;
}): Promise<ExecuteTaskResult> {
  const store = new ApprovalStore();
  const request = await store.get(args.approvalId);
  if (!request) {
    throw new Error(`No approval request found for ${args.approvalId}.`);
  }

  if (request.status !== "approved") {
    throw new Error(`Approval request ${args.approvalId} is ${request.status}, not approved.`);
  }

  const approvedTools = request.plan.approvedTools ?? [];
  const permissionPolicy = (await loadPermissionPolicy()).extend({
    allow: approvedTools,
  });

  return await executeTask({
    prompt: buildApprovedExecutionPrompt({
      prompt: request.prompt,
      approvalId: request.id,
      summary: request.plan.summary,
      goals: request.plan.goals,
      approvedTools,
    }),
    providerName: args.providerName,
    mode: "default",
    echoStdout: args.echoStdout,
    persistSession: args.persistSession,
    persistRunLog: args.persistRunLog,
    permissionPolicy,
    toolNameAllowlist: approvedTools,
    includeReadOnlyToolsInAllowlist: true,
  });
}
