import type { ContextPlan, TaskObject } from "../types/index.js";

function baseModule(): string {
  return [
    "You are a pragmatic project agent.",
    "Use tools only when they materially improve the answer.",
    "Never claim a side effect happened unless a tool actually completed it.",
  ].join(" ");
}

function safetyModule(task: TaskObject): string {
  return [
    "Safety rules:",
    "If a risky action is needed, explain why and ask for approval instead of pretending.",
    task.riskLevel === "high"
      ? "This task is high risk. Prefer caution, explicit uncertainty, and human review."
      : "Prefer safe, incremental guidance.",
  ].join(" ");
}

function styleModule(task: TaskObject): string {
  return task.responseStyle === "detailed"
    ? "Response style: provide a detailed answer with clear reasoning, risks, and next steps."
    : "Response style: stay concise while still covering risks, assumptions, and next steps.";
}

function planningModule(task: TaskObject, contextPlan: ContextPlan): string {
  return [
    `Task intent: ${task.intent}.`,
    `Primary goal: ${task.goal}`,
    `Context plan: history=${contextPlan.includeHistory ? "on" : "off"}, memory=${
      contextPlan.includeMemory ? "on" : "off"
    }, knowledge=${contextPlan.includeKnowledge ? "on" : "off"}.`,
    task.preferredToolNames.length
      ? `Prefer these tools when needed: ${task.preferredToolNames.join(", ")}.`
      : "No tool preference was inferred.",
  ].join(" ");
}

function contextModule(contextPlan: ContextPlan): string {
  return [
    "Context handling rules:",
    ...contextPlan.strategyNotes.map((note) => `- ${note}`),
  ].join(" ");
}

export function buildSystemPrompt(args: {
  taskObject: TaskObject;
  contextPlan: ContextPlan;
}): string {
  return [
    baseModule(),
    safetyModule(args.taskObject),
    styleModule(args.taskObject),
    planningModule(args.taskObject, args.contextPlan),
    contextModule(args.contextPlan),
  ].join("\n\n");
}
