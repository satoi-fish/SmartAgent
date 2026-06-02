import "dotenv/config";

import { resolve } from "node:path";
import { z } from "zod";

import { buildRuntimeContext } from "../context/buildContext.js";
import { FileKnowledgeStore } from "../knowledge/knowledgeStore.js";
import { createProvider } from "../llm/createProvider.js";
import { parseStructuredWithRetry } from "../llm/parseStructuredWithRetry.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { createSessionStore } from "../memory/sessionStore.js";
import type { ApprovalMode, ProviderName, WorkflowPlan } from "../types/index.js";
import { ApprovalStore } from "./approvalStore.js";

const workflowPlanSchema = z.object({
  summary: z.string(),
  goals: z.array(z.string()),
  steps: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["analyze", "retrieve", "tool", "write", "review"]),
      detail: z.string(),
      requiresApproval: z.boolean(),
    }),
  ),
  risks: z.array(z.string()),
  approvalsNeeded: z.array(z.string()),
  suggestedMode: z.enum(["plan", "default", "auto"]),
});

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) {
  process.stderr.write('Usage: npm run plan -- "your task here"\n');
  process.exit(1);
}

const providerName = (process.env.MODEL_PROVIDER ?? "openai") as ProviderName;
const provider = createProvider({
  providerName,
  env: process.env,
});
const memoryStore = new FileMemoryStore();
const sessionStore = await createSessionStore({
  env: process.env,
  filePath: resolve(process.cwd(), ".agent-session.json"),
});
const knowledgeStore = new FileKnowledgeStore();

const runtimeContext = await buildRuntimeContext({
  prompt,
  mode: "plan" as ApprovalMode,
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
    ].join(" "),
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `User request:\n${prompt}`,
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
const request = await approvalStore.create({
  prompt,
  plan,
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
  ].join("\n\n"),
);
