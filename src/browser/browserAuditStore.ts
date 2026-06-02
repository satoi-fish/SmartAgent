import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface BrowserAuditEntry {
  timestamp: string;
  sessionId: string;
  action: string;
  url?: string;
  selector?: string;
  detail?: string;
  success: boolean;
}

export class BrowserAuditStore {
  constructor(
    private readonly filePath = resolve(process.cwd(), ".agent-browser-audit.jsonl"),
  ) {}

  async append(entry: BrowserAuditEntry): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
