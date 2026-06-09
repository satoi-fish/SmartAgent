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

export interface WorkbenchDebugEvent {
  id: string;
  timestamp: string;
  type: AgentEvent["type"];
  summary: string;
  raw: AgentEvent;
}

export interface WorkbenchDebugPayload {
  runId: string;
  source: "real" | "demo";
  totalEvents: number;
  terminalEventType?: AgentEvent["type"];
  events: WorkbenchDebugEvent[];
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

export interface WorkbenchDataSourceMeta {
  totalRuns: number;
  realRuns: number;
  demoRuns: number;
  lastUpdatedAt: string;
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

export interface WorkbenchContextSnapshot {
  goal?: string;
  intent?: string;
  riskLevel?: string;
  mode?: string;
  profile?: string;
  routeDetail?: string;
  historyIncluded?: number;
  historySummarized?: boolean;
  memoryIncluded?: number;
  knowledgeIncluded?: number;
  knowledgeSources: string[];
  strategy: string[];
}

export interface WorkbenchDiagnosticsView {
  totalEvents: number;
  retries: number;
  fallbacks: number;
  approvalsRequested: number;
  cacheHits: number;
  cacheMisses: number;
  cacheWrites: number;
  totalTokens: number;
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
  filterExpression?: string;
  total?: number;
  entries?: Array<{
    timestamp: string;
    level: string;
    service: string;
    environment?: string;
    message: string;
    traceId?: string;
    requestId?: string;
    deploySha?: string;
  }>;
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
  subtitle?: string;
  status: WorkbenchRunStatus;
  prompt: string;
  startedAt: string;
  completedAt?: string;
  provider: string;
  model: string;
  metrics: WorkbenchMetric[];
  context: WorkbenchContextSnapshot;
  diagnostics: WorkbenchDiagnosticsView;
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
  subtitle?: string;
  source: "real" | "demo";
  status: WorkbenchRunStatus;
  startedAt: string;
  completedAt?: string;
  provider?: string;
}

export interface WorkbenchApprovalRecord {
  id: string;
  prompt: string;
  status: string;
  updatedAt: string;
  summary: string;
}

export interface WorkbenchTaskRecord {
  id: string;
  prompt: string;
  status: string;
  trigger: string;
  updatedAt: string;
  approvalId?: string;
  scheduleId?: string;
  runId?: string;
  error?: string;
}

export interface WorkbenchScheduleRecord {
  id: string;
  prompt: string;
  status: string;
  kind: string;
  nextRunAt?: string;
  updatedAt: string;
  approvalId?: string;
  totalRuns: number;
}

export interface WorkbenchRepositoryState {
  branch: string;
  ahead: number;
  behind: number;
  isClean: boolean;
  changedFiles: Array<{
    path: string;
    indexStatus: string;
    workTreeStatus: string;
  }>;
}

export interface WorkbenchOperationsState {
  approvals: WorkbenchApprovalRecord[];
  tasks: WorkbenchTaskRecord[];
  schedules: WorkbenchScheduleRecord[];
  repository: WorkbenchRepositoryState | null;
}
