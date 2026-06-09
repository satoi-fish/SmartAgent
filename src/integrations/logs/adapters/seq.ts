import type { LogLevel, LogPlatformAdapter, LogSearchQuery, LogSearchResult, NormalizedLogEntry } from "../types.js";

const DEFAULT_SERVICE_PROPERTY = "Service";
const DEFAULT_ENVIRONMENT_PROPERTY = "Environment";
const DEFAULT_REQUEST_ID_PROPERTY = "RequestId";
const DEFAULT_DEPLOY_SHA_PROPERTY = "DeploySha";
const DEFAULT_VERSION_PROPERTY = "Version";

type SeqApiEvent = {
  Id?: string;
  id?: string;
  Timestamp?: string;
  timestamp?: string;
  Level?: string;
  level?: string;
  RenderedMessage?: string;
  renderedMessage?: string;
  MessageTemplate?: string;
  messageTemplate?: string;
  Exception?: string;
  exception?: string;
  Properties?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  TraceId?: string;
  traceId?: string;
  Link?: string;
  link?: string;
};

type SeqEventsResponse =
  | SeqApiEvent[]
  | {
      Events?: SeqApiEvent[];
      events?: SeqApiEvent[];
      Items?: SeqApiEvent[];
      items?: SeqApiEvent[];
    };

function escapeSeqString(value: string): string {
  return value.replaceAll("'", "''");
}

function toSeqLevel(level: LogLevel): string {
  switch (level) {
    case "trace":
      return "Verbose";
    case "debug":
      return "Debug";
    case "info":
      return "Information";
    case "warn":
      return "Warning";
    case "error":
      return "Error";
    case "fatal":
      return "Fatal";
  }
}

function fromSeqLevel(value: string | undefined): LogLevel {
  switch ((value ?? "").toLowerCase()) {
    case "verbose":
    case "trace":
      return "trace";
    case "debug":
      return "debug";
    case "information":
    case "info":
      return "info";
    case "warning":
    case "warn":
      return "warn";
    case "error":
      return "error";
    case "fatal":
      return "fatal";
    default:
      return "info";
  }
}

function getStringValue(record: Record<string, unknown>, key: string): string | undefined {
  const direct = record[key];
  if (typeof direct === "string" && direct.trim()) {
    return direct;
  }

  const prefixed = record[`@${key}`];
  if (typeof prefixed === "string" && prefixed.trim()) {
    return prefixed;
  }

  return undefined;
}

function extractEvents(body: SeqEventsResponse): SeqApiEvent[] {
  if (Array.isArray(body)) {
    return body;
  }

  return body.Events ?? body.events ?? body.Items ?? body.items ?? [];
}

function buildSummary(entries: NormalizedLogEntry[]) {
  const summary = new Map<string, { count: number; sampleIds: string[] }>();

  for (const entry of entries) {
    const fingerprint = entry.message || entry.exception || entry.id;
    const current = summary.get(fingerprint) ?? {
      count: 0,
      sampleIds: [],
    };
    current.count += 1;
    if (current.sampleIds.length < 3) {
      current.sampleIds.push(entry.id);
    }
    summary.set(fingerprint, current);
  }

  return [...summary.entries()]
    .map(([fingerprint, value]) => ({
      fingerprint,
      count: value.count,
      sampleIds: value.sampleIds,
    }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);
}

export class SeqLogAdapter implements LogPlatformAdapter {
  readonly kind = "seq";

  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey?: string;
      signal?: string;
      defaultFilter?: string;
      serviceProperty?: string;
      environmentProperty?: string;
      requestIdProperty?: string;
      deployShaProperty?: string;
      versionProperty?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    const response = await this.performRequest(this.buildUrl("/api"));
    return response.ok
      ? { ok: true }
      : { ok: false, detail: `Seq API responded with ${response.status}.` };
  }

  async searchLogs(query: LogSearchQuery): Promise<LogSearchResult> {
    const filterExpression = this.buildFilterExpression(query);
    const url = this.buildUrl("/api/events");

    url.searchParams.set("count", String(query.limit ?? 20));
    url.searchParams.set("render", "true");

    if (this.options.signal) {
      url.searchParams.set("signal", this.options.signal);
    }

    if (query.timeRange?.from) {
      url.searchParams.set("fromDateUtc", query.timeRange.from);
    }

    if (query.timeRange?.to) {
      url.searchParams.set("toDateUtc", query.timeRange.to);
    }

    if (filterExpression) {
      url.searchParams.set("filter", filterExpression);
    }

    const response = await this.performRequest(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Seq log search failed with ${response.status}: ${body.slice(0, 240)}`);
    }

    const payload = (await response.json()) as SeqEventsResponse;
    const entries = extractEvents(payload).map((event) => this.normalizeEvent(event));

    return {
      provider: this.kind,
      filterExpression: filterExpression || undefined,
      total: entries.length,
      entries,
      summary: buildSummary(entries),
    };
  }

  private get fetchFn(): typeof fetch {
    return this.options.fetchImpl ?? fetch;
  }

  private buildUrl(pathname: string): URL {
    const trimmedBase = this.options.baseUrl.replace(/\/+$/, "");
    return new URL(`${trimmedBase}${pathname.startsWith("/") ? pathname : `/${pathname}`}`);
  }

  private async performRequest(url: URL): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.options.apiKey) {
      headers["X-Seq-ApiKey"] = this.options.apiKey;
    }

    return await this.fetchFn(url, {
      method: "GET",
      headers,
    });
  }

  private normalizeEvent(event: SeqApiEvent): NormalizedLogEntry {
    const properties = event.Properties ?? event.properties ?? {};
    const timestamp = event.Timestamp ?? event.timestamp ?? new Date().toISOString();
    const message = event.RenderedMessage ?? event.renderedMessage ?? event.MessageTemplate ?? event.messageTemplate ?? "";
    const exception = event.Exception ?? event.exception;
    const serviceProperty = this.options.serviceProperty ?? DEFAULT_SERVICE_PROPERTY;
    const environmentProperty = this.options.environmentProperty ?? DEFAULT_ENVIRONMENT_PROPERTY;
    const requestIdProperty = this.options.requestIdProperty ?? DEFAULT_REQUEST_ID_PROPERTY;
    const deployShaProperty = this.options.deployShaProperty ?? DEFAULT_DEPLOY_SHA_PROPERTY;
    const versionProperty = this.options.versionProperty ?? DEFAULT_VERSION_PROPERTY;

    return {
      id: event.Id ?? event.id ?? `${timestamp}:${message.slice(0, 24)}`,
      timestamp,
      level: fromSeqLevel(event.Level ?? event.level),
      service: getStringValue(properties, serviceProperty) ?? "unknown",
      environment: getStringValue(properties, environmentProperty),
      message,
      exception,
      traceId: event.TraceId ?? event.traceId ?? getStringValue(properties, "TraceId"),
      requestId: getStringValue(properties, requestIdProperty),
      deploySha: getStringValue(properties, deployShaProperty),
      version: getStringValue(properties, versionProperty),
      rawRef: event.Link ?? event.link,
    };
  }

  private buildFilterExpression(query: LogSearchQuery): string {
    const clauses: string[] = [];

    if (this.options.defaultFilter?.trim()) {
      clauses.push(`(${this.options.defaultFilter.trim()})`);
    }

    if (query.service) {
      clauses.push(this.buildPropertyEquals(this.options.serviceProperty ?? DEFAULT_SERVICE_PROPERTY, query.service));
    }

    if (query.environment) {
      clauses.push(
        this.buildPropertyEquals(this.options.environmentProperty ?? DEFAULT_ENVIRONMENT_PROPERTY, query.environment),
      );
    }

    if (query.requestId) {
      clauses.push(
        this.buildPropertyEquals(this.options.requestIdProperty ?? DEFAULT_REQUEST_ID_PROPERTY, query.requestId),
      );
    }

    if (query.deploySha) {
      clauses.push(
        this.buildPropertyEquals(this.options.deployShaProperty ?? DEFAULT_DEPLOY_SHA_PROPERTY, query.deploySha),
      );
    }

    if (query.traceId) {
      clauses.push(`@TraceId = '${escapeSeqString(query.traceId)}'`);
    }

    if (query.text) {
      const needle = escapeSeqString(query.text);
      clauses.push(
        `(Contains(@Message, '${needle}') or Contains(@Exception, '${needle}') or Contains(ToJson(@Properties), '${needle}'))`,
      );
    }

    if (query.levels?.length) {
      const levelClauses = query.levels.map((level) => `@Level = '${toSeqLevel(level)}'`);
      clauses.push(`(${levelClauses.join(" or ")})`);
    }

    return clauses.join(" and ");
  }

  private buildPropertyEquals(propertyName: string, value: string): string {
    return `@Properties['${escapeSeqString(propertyName)}'] = '${escapeSeqString(value)}'`;
  }
}
