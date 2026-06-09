export type ApprovalMode = "plan" | "default" | "auto";
export type ProviderName = "openai" | "anthropic" | "google" | "deepseek" | "azure-openai";
export type ModelProfile = "fast" | "reasoning" | "long_context";
export type TeamMode = "single" | "planner_reviewer";
export type TaskIntent =
  | "general_qa"
  | "planning"
  | "deployment"
  | "incident"
  | "memory_management"
  | "write_action";
export type TaskRiskLevel = "low" | "medium" | "high";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed";
export type AttachmentKind = "text" | "image" | "table" | "document" | "unsupported";
export type TaskTrigger = "manual" | "schedule";
export type ScheduleKind = "once" | "interval";
export type ScheduleStatus = "active" | "paused" | "dispatching" | "completed";

export type ToolRiskLevel = "low" | "medium" | "high";

export type ToolLifecycleStatus =
  | "validating"
  | "awaiting_approval"
  | "scheduled"
  | "executing"
  | "success"
  | "error"
  | "cancelled";

export type AgentEvent =
  | {
      type: "run_started";
      prompt: string;
      mode: ApprovalMode;
      provider: ProviderName;
      model: string;
      profile: ModelProfile;
      detail?: string;
    }
  | {
      type: "team_mode";
      mode: TeamMode;
    }
  | {
      type: "attachments_loaded";
      count: number;
      files: string[];
    }
  | {
      type: "knowledge_retrieved";
      count: number;
      sources: string[];
    }
  | {
      type: "task_parsed";
      intent: TaskIntent;
      riskLevel: TaskRiskLevel;
      goal: string;
      uses_history: boolean;
      uses_memory: boolean;
      uses_knowledge: boolean;
    }
  | {
      type: "approval_requested";
      approval_id: string;
      title: string;
    }
  | {
      type: "approval_updated";
      approval_id: string;
      status: ApprovalStatus;
    }
  | {
      type: "background_task";
      task_id: string;
      status: BackgroundTaskStatus;
      detail?: string;
    }
  | {
      type: "planner_brief";
      summary: string;
      focus: string[];
    }
  | {
      type: "review_report";
      approved: boolean;
      concerns: string[];
    }
  | {
      type: "context_compacted";
      history_included: number;
      history_summarized: boolean;
      memory_included: number;
      knowledge_included: number;
      strategy: string[];
    }
  | {
      type: "budget_selected";
      max_turns: number;
      max_tool_calls: number;
      max_total_tokens: number;
      max_output_tokens: number;
      max_retries: number;
      max_run_duration_ms: number;
      max_tool_execution_ms: number;
      max_repeated_tool_calls: number;
      max_consecutive_empty_turns: number;
    }
  | {
      type: "cache_event";
      key: string;
      status: "hit" | "miss" | "write";
      namespace: string;
    }
  | {
      type: "fallback_used";
      from_model: string;
      to_model: string;
      reason: string;
    }
  | {
      type: "run_retrying";
      attempt: number;
      model: string;
      reason: string;
    }
  | {
      type: "llm_usage";
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    }
  | {
      type: "tool_status";
      toolName: string;
      status: ToolLifecycleStatus;
      detail?: string;
    }
  | {
      type: "tool_result";
      toolName: string;
      summary: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "model_output";
      text: string;
    }
  | {
      type: "output_text_delta";
      delta: string;
    }
  | {
      type: "run_completed";
      answer: string;
    }
  | {
      type: "run_failed";
      error: string;
    };

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  isReadOnly: boolean;
  jsonSchema: Record<string, unknown>;
  validate: (args: unknown) => TArgs;
  requiresApproval: (mode: ApprovalMode) => boolean;
  execute: (args: TArgs) => Promise<TResult>;
  renderForModel: (result: TResult) => string;
  toEventData?: (result: TResult) => Record<string, unknown> | undefined;
}

export type AnyToolDefinition = ToolDefinition<any, any>;

export interface MemoryRecord {
  id: string;
  text: string;
  tags: string[];
  scope: "project" | "user";
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  title: string;
  content: string;
  sourcePath: string;
  score: number;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  timestamp: string;
}

export interface RuntimeBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxTotalTokens: number;
  maxOutputTokens: number;
  maxRetries: number;
  maxRunDurationMs: number;
  maxToolExecutionMs: number;
  maxRepeatedToolCalls: number;
  maxConsecutiveEmptyTurns: number;
}

export interface ModelCapability {
  provider: ProviderName;
  model: string;
  profile: ModelProfile;
  maxContext: "standard" | "long";
  supportsTools: boolean;
  supportsStructuredOutputs: boolean;
  supportsVision: boolean;
  costTier: "low" | "medium" | "high";
}

export interface RoutedModel {
  provider: ProviderName;
  model: string;
  profile: ModelProfile;
  reason: string;
  capability: ModelCapability;
}

export interface StructuredFinalAnswer {
  summary: string;
  answer: string;
  risks: string[];
  next_steps: string[];
  citations: string[];
  needs_human_review: boolean;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentRunResult {
  rawAnswer: string;
  renderedAnswer: string;
  structuredAnswer: StructuredFinalAnswer;
  toolCalls: string[];
  usage: UsageTotals;
}

export interface TaskObject {
  goal: string;
  intent: TaskIntent;
  riskLevel: TaskRiskLevel;
  requiresKnowledge: boolean;
  requiresMemory: boolean;
  shouldUseHistory: boolean;
  responseStyle: "concise" | "detailed";
  preferredToolNames: string[];
  keywords: string[];
}

export interface WorkflowPlanStep {
  title: string;
  kind: "analyze" | "retrieve" | "tool" | "write" | "review";
  detail: string;
  requiresApproval: boolean;
  toolName?: string;
}

export interface WorkflowPlan {
  summary: string;
  goals: string[];
  steps: WorkflowPlanStep[];
  risks: string[];
  approvalsNeeded: string[];
  suggestedMode: ApprovalMode;
  approvedTools: string[];
}

export interface PlannerBrief {
  summary: string;
  focusAreas: string[];
  toolHints: string[];
  reviewChecks: string[];
}

export interface ReviewReport {
  approved: boolean;
  concerns: string[];
  recommendedChanges: string[];
}

export interface ApprovalRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  prompt: string;
  status: ApprovalStatus;
  plan: WorkflowPlan;
}

export interface BackgroundTask {
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  status: BackgroundTaskStatus;
  trigger: TaskTrigger;
  approvalId?: string;
  scheduleId?: string;
  runId?: string;
  logPath?: string;
  resultSummary?: string;
  error?: string;
}

export interface TaskSchedule {
  id: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  kind: ScheduleKind;
  status: ScheduleStatus;
  nextRunAt?: string;
  runAt?: string;
  everyMinutes?: number;
  approvalId?: string;
  lastRunAt?: string;
  lastTaskId?: string;
  claimId?: string;
  claimedAt?: string;
  totalRuns: number;
}

export interface LoadedAttachment {
  path: string;
  kind: AttachmentKind;
  summary: string;
  content:
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "low" | "high" | "auto" }
    | null;
}

export interface ContextPlan {
  includeHistory: boolean;
  includeMemory: boolean;
  includeKnowledge: boolean;
  historyLimit: number;
  memoryLimit: number;
  knowledgeLimit: number;
  historySummary: string | null;
  strategyNotes: string[];
}

export interface RuntimeContext {
  systemPrompt: string;
  taskObject: TaskObject;
  contextPlan: ContextPlan;
  memoryHits: MemoryRecord[];
  knowledgeHits: KnowledgeChunk[];
  recentHistory: ConversationTurn[];
  routedModel: RoutedModel;
  fallbackModels: string[];
  budget: RuntimeBudget;
  mode: ApprovalMode;
}
