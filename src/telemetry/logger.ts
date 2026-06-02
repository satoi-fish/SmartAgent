import type { AgentEvent } from "../types/index.js";

export class Logger {
  emit(event: AgentEvent): void {
    const now = new Date().toISOString();
    process.stdout.write(`${now} ${JSON.stringify(event)}\n`);
  }
}
