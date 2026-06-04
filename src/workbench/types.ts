import type { AgentEvent } from "../types/index.js";
import type { RunSummary } from "../telemetry/fileLogger.js";

export type WorkbenchRunStatus = "running" | "completed" | "failed" | "blocked";
export type WorkbenchStageStatus = "pending" | "running" | "success" | "error" | "blocked";
export type WorkbenchTone = "neutral" | "success" | "warning" | "danger" | "accent";
export type WorkbenchActivityStatus = "info" | "success" | "warning" | "error";

export interface PersistedRunEvent {
  timestamp: string;
  event: AgentEvent;
}

export interface PersistedRunLog {
  runId: string;
  startedAt: string;
  completedAt: string;
  summary: RunSummary;
  events: PersistedRunEvent[];
}

export interface WorkbenchMetric {
  label: string;
  value: string;
  tone?: WorkbenchTone;
}

export interface WorkbenchStageView {
  id: string;
  title: string;
  status: WorkbenchStageStatus;
  summary: string;
  detail?: string;
}

export interface WorkbenchActivityItem {
  id: string;
  timestamp: string;
  category: "run" | "context" | "tool" | "approval" | "review" | "system";
  title: string;
  detail: string;
  status: WorkbenchActivityStatus;
}

export interface WorkbenchToolView {
  name: string;
  latestStatus: string;
  count: number;
  lastDetail?: string;
}

export interface WorkbenchApprovalView {
  id: string;
  title: string;
  status: string;
}

export interface WorkbenchPipelineView {
  title: string;
  provider: string;
  status: string;
  summary: string;
  branch?: string;
  commitSha?: string;
  jobs?: Array<{
    name: string;
    status: string;
  }>;
}

export interface WorkbenchLogInsightView {
  title: string;
  provider: string;
  status: string;
  summary: string;
  highlights: string[];
}

export interface WorkbenchBrowserTestView {
  title: string;
  provider: string;
  status: string;
  scenario: string;
  summary: string;
  screenshots: string[];
  artifacts: string[];
}

export interface WorkbenchFinalReport {
  summary: string;
  answer: string;
  risks: string[];
  nextSteps: string[];
  citations: string[];
  needsHumanReview: boolean;
}

export interface WorkbenchRunView {
  id: string;
  source: "real" | "demo";
  label: string;
  status: WorkbenchRunStatus;
  prompt: string;
  startedAt: string;
  completedAt?: string;
  provider: string;
  model: string;
  metrics: WorkbenchMetric[];
  stages: WorkbenchStageView[];
  activities: WorkbenchActivityItem[];
  tools: WorkbenchToolView[];
  approvals: WorkbenchApprovalView[];
  finalReport: WorkbenchFinalReport;
  pipeline?: WorkbenchPipelineView;
  logs?: WorkbenchLogInsightView;
  browserTest?: WorkbenchBrowserTestView;
}

export interface WorkbenchRunListItem {
  id: string;
  label: string;
  source: "real" | "demo";
  status: WorkbenchRunStatus;
  startedAt: string;
  provider?: string;
}
