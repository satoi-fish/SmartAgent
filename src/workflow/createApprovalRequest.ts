import { resolve } from "node:path";

import { z } from "zod";

import { buildRuntimeContext } from "../context/buildContext.js";
import { FileKnowledgeStore } from "../knowledge/knowledgeStore.js";
import { createProvider } from "../llm/createProvider.js";
import { parseStructuredWithRetry } from "../llm/parseStructuredWithRetry.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { createSessionStore } from "../memory/sessionStore.js";
import { ALL_TOOL_NAMES, APPROVABLE_TOOL_NAMES } from "../tools/catalog.js";
import type { ApprovalMode, ApprovalRequest, ProviderName, WorkflowPlan } from "../types/index.js";
import { ApprovalStore } from "./approvalStore.js";

export const workflowPlanSchema = z.object({
  summary: z.string(),
  goals: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["analyze", "retrieve", "tool", "write", "review"]),
      detail: z.string(),
      requiresApproval: z.boolean(),
      toolName: z.enum(ALL_TOOL_NAMES).optional(),
    }),
  ),
  risks: z.array(z.string()),
  approvalsNeeded: z.array(z.string()),
  suggestedMode: z.enum(["plan", "default", "auto"]),
  approvedTools: z.array(z.enum(APPROVABLE_TOOL_NAMES)),
});

export async function createApprovalRequestFromPrompt(args: {
  prompt: string;
  providerName: ProviderName;
  mode?: ApprovalMode;
}): Promise<ApprovalRequest> {
  const provider = createProvider({
    providerName: args.providerName,
    env: process.env,
  });
  const memoryStore = new FileMemoryStore();
  const sessionStore = await createSessionStore({
    env: process.env,
    filePath: resolve(process.cwd(), ".agent-session.json"),
  });
  const knowledgeStore = new FileKnowledgeStore();

  const runtimeContext = await buildRuntimeContext({
    prompt: args.prompt,
    mode: args.mode ?? "plan",
    provider,
    memoryStore,
    sessionStore,
    knowledgeStore,
  });

  const plan = await parseStructuredWithRetry<WorkflowPlan>({
    provider,
    request: {
      model: runtimeContext.routedModel.model,
      instructions: [
        "Create a human-reviewable execution plan for an engineering agent.",
        "The plan must be actionable, concise, and explicit about approvals and risks.",
        "If the task implies writes or production risk, mark the relevant steps with requiresApproval=true.",
        `Only use toolName values from this catalog when a step depends on a specific tool: ${ALL_TOOL_NAMES.join(", ")}.`,
        `List every approval-gated tool needed for execution in approvedTools, using only: ${APPROVABLE_TOOL_NAMES.join(", ")}.`,
        "Do not add a tool to approvedTools unless the approved execution really needs that capability.",
      ].join(" "),
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `User request:\n${args.prompt}`,
                `Task intent: ${runtimeContext.taskObject.intent}`,
                `Task risk: ${runtimeContext.taskObject.riskLevel}`,
                `Suggested tools: ${runtimeContext.taskObject.preferredToolNames.join(", ") || "none"}`,
                runtimeContext.knowledgeHits.length
                  ? `Relevant knowledge:\n- ${runtimeContext.knowledgeHits
                      .map((hit) => `${hit.id}: ${hit.content}`)
                      .join("\n- ")}`
                  : "Relevant knowledge: none",
              ].join("\n\n"),
            },
          ],
        },
      ],
      schema: workflowPlanSchema,
      schemaName: "workflow_plan",
    },
  });

  const approvalStore = new ApprovalStore();
  return await approvalStore.create({
    prompt: args.prompt,
    plan,
  });
}
