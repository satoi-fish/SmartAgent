import type { AgentEvent } from "../types/index.js";

import type {
  PersistedRunLog,
  WorkbenchActivityItem,
  WorkbenchApprovalView,
  WorkbenchRunStatus,
  WorkbenchRunView,
  WorkbenchStageStatus,
  WorkbenchToolView,
} from "./types.js";

function asRunStatus(log: PersistedRunLog): WorkbenchRunStatus {
  const lastTerminalEvent = [...log.events]
    .reverse()
    .find((entry) => entry.event.type === "run_completed" || entry.event.type === "run_failed");

  if (lastTerminalEvent?.event.type === "run_failed") {
    return "failed";
  }

  if (log.summary.needsHumanReview) {
    return "blocked";
  }

  return "completed";
}

function metricTone(status: WorkbenchRunStatus): "success" | "warning" | "danger" {
  switch (status) {
    case "completed":
      return "success";
    case "blocked":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "warning";
  }
}

function activityFromEvent(index: number, timestamp: string, event: AgentEvent): WorkbenchActivityItem | null {
  switch (event.type) {
    case "run_started":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "run",
        title: "Run started",
        detail: `${event.provider}/${event.model} started in ${event.mode} mode.`,
        status: "info",
      };
    case "task_parsed":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "context",
        title: "Task parsed",
        detail: `${event.intent} task with ${event.riskLevel} risk. Goal: ${event.goal}`,
        status: "success",
      };
    case "context_compacted":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "context",
        title: "Context prepared",
        detail: `History ${event.history_included}, memory ${event.memory_included}, knowledge ${event.knowledge_included}.`,
        status: "success",
      };
    case "knowledge_retrieved":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "context",
        title: "Knowledge retrieved",
        detail: `${event.count} source(s) selected for this run.`,
        status: "info",
      };
    case "tool_status":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "tool",
        title: `${event.toolName} · ${event.status}`,
        detail: event.detail ?? "Tool state updated.",
        status: event.status === "error" ? "error" : event.status === "awaiting_approval" ? "warning" : "info",
      };
    case "approval_requested":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "approval",
        title: "Approval requested",
        detail: event.title,
        status: "warning",
      };
    case "approval_updated":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "approval",
        title: `Approval ${event.status}`,
        detail: event.approval_id,
        status: event.status === "approved" ? "success" : event.status === "rejected" ? "error" : "info",
      };
    case "fallback_used":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "system",
        title: "Fallback model used",
        detail: `${event.from_model} -> ${event.to_model}. ${event.reason}`,
        status: "warning",
      };
    case "run_retrying":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "system",
        title: "Run retrying",
        detail: `Attempt ${event.attempt} on ${event.model}. ${event.reason}`,
        status: "warning",
      };
    case "review_report":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "review",
        title: event.approved ? "Review approved" : "Review raised concerns",
        detail: event.concerns.join(" | ") || "No concerns listed.",
        status: event.approved ? "success" : "warning",
      };
    case "run_completed":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "run",
        title: "Run completed",
        detail: event.answer.slice(0, 180),
        status: "success",
      };
    case "run_failed":
      return {
        id: `activity_${index}`,
        timestamp,
        category: "run",
        title: "Run failed",
        detail: event.error,
        status: "error",
      };
    default:
      return null;
  }
}

function buildTools(log: PersistedRunLog): WorkbenchToolView[] {
  const tools = new Map<string, WorkbenchToolView>();

  for (const entry of log.events) {
    if (entry.event.type !== "tool_status") {
      continue;
    }

    const current = tools.get(entry.event.toolName) ?? {
      name: entry.event.toolName,
      latestStatus: entry.event.status,
      count: 0,
      lastDetail: entry.event.detail,
    };

    current.latestStatus = entry.event.status;
    current.count += 1;
    current.lastDetail = entry.event.detail ?? current.lastDetail;
    tools.set(entry.event.toolName, current);
  }

  return [...tools.values()].sort((left, right) => right.count - left.count);
}

function buildApprovals(log: PersistedRunLog): WorkbenchApprovalView[] {
  const approvals = new Map<string, WorkbenchApprovalView>();

  for (const entry of log.events) {
    if (entry.event.type === "approval_requested") {
      approvals.set(entry.event.approval_id, {
        id: entry.event.approval_id,
        title: entry.event.title,
        status: "pending",
      });
      continue;
    }

    if (entry.event.type === "approval_updated") {
      const current = approvals.get(entry.event.approval_id) ?? {
        id: entry.event.approval_id,
        title: entry.event.approval_id,
        status: entry.event.status,
      };
      current.status = entry.event.status;
      approvals.set(entry.event.approval_id, current);
    }
  }

  return [...approvals.values()];
}

function stageStatus(args: {
  complete: boolean;
  failed: boolean;
  blocked?: boolean;
}): WorkbenchStageStatus {
  if (args.failed) {
    return "error";
  }
  if (args.blocked) {
    return "blocked";
  }
  return args.complete ? "success" : "pending";
}

export function buildWorkbenchRunView(log: PersistedRunLog): WorkbenchRunView {
  const status = asRunStatus(log);
  const approvals = buildApprovals(log);
  const tools = buildTools(log);
  const activities = log.events
    .map((entry, index) => activityFromEvent(index, entry.timestamp, entry.event))
    .filter((item): item is WorkbenchActivityItem => Boolean(item));
  const eventTypes = new Set(log.events.map((entry) => entry.event.type));
  const hasFailure = status === "failed";
  const isBlocked = status === "blocked";

  return {
    id: log.runId,
    source: "real",
    label: `Run ${log.runId.slice(0, 18)}`,
    status,
    prompt: log.summary.prompt,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    provider: log.summary.provider,
    model: log.summary.model,
    metrics: [
      { label: "Status", value: status, tone: metricTone(status) },
      { label: "Provider", value: log.summary.provider, tone: "accent" },
      { label: "Model", value: log.summary.model, tone: "neutral" },
      { label: "Tokens", value: String(log.summary.totalTokens), tone: "neutral" },
      { label: "Tools", value: String(log.summary.toolCalls.length), tone: "neutral" },
      {
        label: "Human Review",
        value: log.summary.needsHumanReview ? "needed" : "not needed",
        tone: log.summary.needsHumanReview ? "warning" : "success",
      },
    ],
    stages: [
      {
        id: "intake",
        title: "Intake",
        status: stageStatus({ complete: eventTypes.has("run_started"), failed: false }),
        summary: "Prompt intake and task classification.",
        detail: log.summary.prompt,
      },
      {
        id: "context",
        title: "Context",
        status: stageStatus({
          complete: eventTypes.has("task_parsed") || eventTypes.has("context_compacted"),
          failed: false,
        }),
        summary: "History, memory, knowledge, and budget selection.",
        detail: eventTypes.has("knowledge_retrieved") ? "Knowledge retrieval was used." : "No knowledge retrieval in this run.",
      },
      {
        id: "execution",
        title: "Execution",
        status: stageStatus({
          complete: tools.length > 0 || eventTypes.has("llm_usage"),
          failed: hasFailure,
          blocked: false,
        }),
        summary: "Model generation, tool calls, retries, and fallback handling.",
        detail: tools.length > 0 ? `${tools.length} tool(s) were involved.` : "No external tools were needed.",
      },
      {
        id: "review",
        title: "Review",
        status: stageStatus({
          complete: approvals.length > 0 || eventTypes.has("review_report"),
          failed: false,
          blocked: isBlocked,
        }),
        summary: "Approval and reviewer checkpoints.",
        detail:
          approvals.length > 0
            ? `${approvals.length} approval event(s) were recorded.`
            : eventTypes.has("review_report")
              ? "Reviewer flow was used."
              : "No explicit approval or reviewer flow in this run.",
      },
      {
        id: "finalize",
        title: "Finalize",
        status: stageStatus({
          complete: eventTypes.has("run_completed"),
          failed: hasFailure,
          blocked: isBlocked,
        }),
        summary: "Final answer packaging and operator handoff.",
        detail: log.summary.summary,
      },
    ],
    activities,
    tools,
    approvals,
    finalReport: {
      summary: log.summary.summary,
      answer: log.summary.answer,
      risks: log.summary.risks,
      nextSteps: log.summary.nextSteps,
      citations: log.summary.citations,
      needsHumanReview: log.summary.needsHumanReview,
    },
  };
}
