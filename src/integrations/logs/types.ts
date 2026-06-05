export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface TimeRange {
  from?: string;
  to?: string;
}

export interface NormalizedLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  service: string;
  environment?: string;
  message: string;
  exception?: string;
  traceId?: string;
  requestId?: string;
  deploySha?: string;
  version?: string;
  rawRef?: string;
}

export interface LogSearchQuery {
  service?: string;
  environment?: string;
  text?: string;
  traceId?: string;
  requestId?: string;
  deploySha?: string;
  levels?: LogLevel[];
  limit?: number;
  timeRange?: TimeRange;
}

export interface LogSummaryItem {
  fingerprint: string;
  count: number;
  sampleIds: string[];
}

export interface LogSearchResult {
  provider: string;
  filterExpression?: string;
  total: number;
  entries: NormalizedLogEntry[];
  summary: LogSummaryItem[];
}

export interface LogPlatformAdapter {
  readonly kind: string;
  healthCheck?(): Promise<{ ok: boolean; detail?: string }>;
  searchLogs(query: LogSearchQuery): Promise<LogSearchResult>;
}
