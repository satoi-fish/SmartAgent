import type { LogPlatformAdapter, LogSearchQuery, LogSearchResult } from "./types.js";

export class LogService {
  constructor(private readonly adapter: LogPlatformAdapter) {}

  get providerKind(): string {
    return this.adapter.kind;
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    if (!this.adapter.healthCheck) {
      return { ok: true };
    }

    return await this.adapter.healthCheck();
  }

  async searchLogs(query: LogSearchQuery): Promise<LogSearchResult> {
    return await this.adapter.searchLogs(query);
  }
}
