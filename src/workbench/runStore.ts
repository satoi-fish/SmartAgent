import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildWorkbenchRunView } from "./buildRunView.js";
import { buildDemoPipelineRun } from "./demoRun.js";
import type {
  PersistedRunLog,
  WorkbenchDataSourceMeta,
  WorkbenchDebugEvent,
  WorkbenchDebugPayload,
  WorkbenchRunListItem,
  WorkbenchRunView,
} from "./types.js";

function summarizeEvent(event: PersistedRunLog["events"][number]["event"]): string {
  switch (event.type) {
    case "run_started":
      return `${event.provider}/${event.model} in ${event.mode} mode`;
    case "task_parsed":
      return `${event.intent} (${event.riskLevel})`;
    case "context_compacted":
      return `history=${event.history_included}, memory=${event.memory_included}, knowledge=${event.knowledge_included}`;
    case "knowledge_retrieved":
      return `${event.count} source(s)`;
    case "approval_requested":
      return event.title;
    case "approval_updated":
      return `${event.approval_id} -> ${event.status}`;
    case "planner_brief":
      return event.summary;
    case "review_report":
      return event.approved ? "approved" : `concerns: ${event.concerns.join(" | ")}`;
    case "budget_selected":
      return `turns=${event.max_turns}, tools=${event.max_tool_calls}, output=${event.max_output_tokens}`;
    case "cache_event":
      return `${event.namespace}:${event.status}`;
    case "fallback_used":
      return `${event.from_model} -> ${event.to_model}`;
    case "run_retrying":
      return `attempt ${event.attempt} on ${event.model}`;
    case "llm_usage":
      return `${event.total_tokens} tokens`;
    case "tool_status":
      return `${event.toolName} · ${event.status}`;
    case "tool_result":
      return `${event.toolName}: ${event.summary.slice(0, 80)}`;
    case "model_output":
      return event.text.slice(0, 80);
    case "output_text_delta":
      return event.delta.slice(0, 80);
    case "run_completed":
      return event.answer.slice(0, 80);
    case "run_failed":
      return event.error;
    case "team_mode":
      return event.mode;
    case "attachments_loaded":
      return `${event.count} attachment(s)`;
    case "background_task":
      return `${event.task_id} -> ${event.status}`;
    default:
      return "unknown";
  }
}

function asDebugEvents(log: PersistedRunLog): WorkbenchDebugEvent[] {
  return log.events.map((entry, index) => ({
    id: `${log.runId}_event_${index}`,
    timestamp: entry.timestamp,
    type: entry.event.type,
    summary: summarizeEvent(entry.event),
    raw: entry.event,
  }));
}

function createDemoDebugPayload(): WorkbenchDebugPayload {
  const now = Date.now();
  const demoEvents = [
    {
      type: "run_started",
      mode: "default",
      provider: "openai",
      model: "gpt-5.1",
      profile: "reasoning",
      prompt: "修复测试环境中订单创建后详情页白屏的问题，并完成一次验证闭环。",
      detail: "Reasoning route selected for a bug-fix workflow.",
    },
    {
      type: "task_parsed",
      intent: "incident",
      riskLevel: "medium",
      goal: "Fix staging order detail blank screen and validate the user path.",
      uses_history: true,
      uses_memory: true,
      uses_knowledge: true,
    },
    {
      type: "tool_status",
      toolName: "trigger_pipeline",
      status: "error",
      detail: "CI snapshot mismatch detected on the first validation attempt.",
    },
    {
      type: "run_retrying",
      attempt: 2,
      model: "gpt-5.1",
      reason: "Retrying after automated patch generation.",
    },
    {
      type: "tool_status",
      toolName: "query_seq_logs",
      status: "success",
      detail: "Grouped warning events by deploy sha for the latest staging release.",
    },
    {
      type: "tool_result",
      toolName: "query_seq_logs",
      summary: "Seq returned 12 warning entries clustered into 2 deploy fingerprints.",
      data: {
        provider: "seq",
        total: 12,
        filterExpression: "@Properties['Service'] = 'checkout-web' and @Level = 'Warning'",
        summary: [
          { fingerprint: "Hydration warning after deploy", count: 8 },
          { fingerprint: "Late config fetch warning", count: 4 },
        ],
        entries: [
          {
            timestamp: new Date(now - 90_000).toISOString(),
            level: "warn",
            service: "checkout-web",
            environment: "staging",
            message: "Hydration mismatch warning after the latest deploy.",
            deploySha: "9ab2c41",
          },
        ],
      },
    },
    {
      type: "approval_requested",
      approval_id: "approval_demo_warning_check",
      title: "Review whether the new warning volume is acceptable.",
    },
  ] satisfies PersistedRunLog["events"][number]["event"][];

  const events = demoEvents.map((event, index) => ({
    id: `demo_event_${index}`,
    timestamp: new Date(now - (demoEvents.length - index) * 60_000).toISOString(),
    type: event.type,
    summary: summarizeEvent(event),
    raw: event,
  }));

  return {
    runId: "demo-pipeline",
    source: "demo",
    totalEvents: events.length,
    terminalEventType: "approval_requested",
    events,
  };
}

function getLogDir(logDir?: string): string {
  return logDir ?? resolve(process.cwd(), ".agent-runs");
}

async function readPersistedRunLog(filePath: string): Promise<PersistedRunLog> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as PersistedRunLog;
}

export async function listPersistedRunLogs(logDir?: string): Promise<PersistedRunLog[]> {
  const dir = getLogDir(logDir);
  let entries: string[] = [];

  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const runFiles = entries.filter((entry) => entry.endsWith(".json")).sort().reverse();
  const runs: PersistedRunLog[] = [];

  for (const file of runFiles) {
    try {
      runs.push(await readPersistedRunLog(resolve(dir, file)));
    } catch {
      // Ignore malformed run logs so the workbench can still boot.
    }
  }

  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function listWorkbenchRuns(logDir?: string): Promise<WorkbenchRunListItem[]> {
  const persistedRuns = await listPersistedRunLogs(logDir);
  const realRuns = persistedRuns.map((run) => {
    const view = buildWorkbenchRunView(run);
    return {
      id: view.id,
      label: view.label,
      subtitle: view.subtitle,
      source: view.source,
      status: view.status,
      startedAt: view.startedAt,
      completedAt: view.completedAt,
      provider: view.provider,
    } satisfies WorkbenchRunListItem;
  });

  return [
    buildDemoRunListItem(),
    ...realRuns,
  ];
}

function buildDemoRunListItem(): WorkbenchRunListItem {
  const demo = buildDemoPipelineRun();
  return {
    id: demo.id,
    label: demo.label,
    subtitle: demo.subtitle,
    source: demo.source,
    status: demo.status,
    startedAt: demo.startedAt,
    completedAt: demo.completedAt,
    provider: demo.provider,
  };
}

export async function loadWorkbenchMeta(logDir?: string): Promise<WorkbenchDataSourceMeta> {
  const persistedRuns = await listPersistedRunLogs(logDir);
  return {
    totalRuns: persistedRuns.length + 1,
    realRuns: persistedRuns.length,
    demoRuns: 1,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export async function loadWorkbenchRun(id: string, logDir?: string): Promise<WorkbenchRunView | null> {
  if (id === "demo-pipeline") {
    return buildDemoPipelineRun();
  }

  const persistedRuns = await listPersistedRunLogs(logDir);
  const match = persistedRuns.find((run) => run.runId === id);
  if (!match) {
    return null;
  }

  return buildWorkbenchRunView(match);
}

export async function loadDefaultWorkbenchRun(logDir?: string): Promise<WorkbenchRunView> {
  const persistedRuns = await listPersistedRunLogs(logDir);
  if (persistedRuns.length > 0) {
    return buildWorkbenchRunView(persistedRuns[0]);
  }

  return buildDemoPipelineRun();
}

export async function loadWorkbenchDebugPayload(id: string, logDir?: string): Promise<WorkbenchDebugPayload | null> {
  if (id === "demo-pipeline") {
    return createDemoDebugPayload();
  }

  const persistedRuns = await listPersistedRunLogs(logDir);
  const match = persistedRuns.find((run) => run.runId === id);
  if (!match) {
    return null;
  }

  const events = asDebugEvents(match);
  return {
    runId: match.runId,
    source: "real",
    totalEvents: events.length,
    terminalEventType: [...events].reverse().find((item) => item.type === "run_completed" || item.type === "run_failed")?.type,
    events,
  };
}
