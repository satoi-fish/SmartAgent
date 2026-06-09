import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { AgentEvent } from "../types/index.js";

interface LoggedEvent {
  timestamp: string;
  event: AgentEvent;
}

export interface RunSummary {
  prompt: string;
  summary: string;
  answer: string;
  risks: string[];
  nextSteps: string[];
  citations: string[];
  toolCalls: string[];
  totalTokens: number;
  needsHumanReview: boolean;
  model: string;
  provider: string;
}

export class FileLogger {
  readonly runId = `run_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
  private readonly startedAt = new Date().toISOString();
  private readonly events: LoggedEvent[] = [];

  constructor(
    private readonly options: {
      echoStdout?: boolean;
      logDir?: string;
    } = {},
  ) {}

  emit(event: AgentEvent): void {
    const entry = {
      timestamp: new Date().toISOString(),
      event,
    };

    this.events.push(entry);

    if (this.options.echoStdout ?? true) {
      process.stdout.write(`${entry.timestamp} ${JSON.stringify(event)}\n`);
    }
  }

  async flush(summary: RunSummary): Promise<string> {
    const logDir = this.options.logDir ?? resolve(process.cwd(), ".agent-runs");
    const outputPath = resolve(logDir, `${this.runId}.json`);

    await mkdir(logDir, { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          runId: this.runId,
          startedAt: this.startedAt,
          completedAt: new Date().toISOString(),
          summary,
          events: this.events,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    return outputPath;
  }
}
