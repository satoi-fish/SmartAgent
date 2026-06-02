import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ShellAuditEntry {
  timestamp: string;
  toolName: string;
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  durationMs: number;
  stdoutPreview: string;
  stderrPreview: string;
}

export class ShellAuditStore {
  constructor(
    private readonly filePath = resolve(process.cwd(), ".agent-shell-audit.jsonl"),
  ) {}

  async append(entry: ShellAuditEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
