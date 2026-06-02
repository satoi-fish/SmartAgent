import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ScheduleKind, ScheduleStatus, TaskSchedule } from "../types/index.js";

export class ScheduleStore {
  constructor(private readonly filePath = resolve(process.cwd(), ".agent-schedules.json")) {}

  async create(args: {
    prompt: string;
    kind: ScheduleKind;
    runAt?: string;
    everyMinutes?: number;
    approvalId?: string;
  }): Promise<TaskSchedule> {
    const schedules = await this.readAll();
    const now = new Date().toISOString();
    const schedule: TaskSchedule = {
      id: `schedule_${randomUUID().slice(0, 10)}`,
      prompt: args.prompt,
      createdAt: now,
      updatedAt: now,
      kind: args.kind,
      status: "active",
      nextRunAt: args.kind === "once" ? args.runAt : nowPlusMinutes(args.everyMinutes ?? 0),
      runAt: args.runAt,
      everyMinutes: args.everyMinutes,
      approvalId: args.approvalId,
      totalRuns: 0,
    };

    schedules.push(schedule);
    await this.writeAll(schedules);
    return schedule;
  }

  async get(id: string): Promise<TaskSchedule | null> {
    const schedules = await this.readAll();
    return schedules.find((item) => item.id === id) ?? null;
  }

  async list(status?: ScheduleStatus): Promise<TaskSchedule[]> {
    const schedules = await this.readAll();
    return status ? schedules.filter((item) => item.status === status) : schedules;
  }

  async listDue(referenceTime = new Date()): Promise<TaskSchedule[]> {
    const schedules = await this.readAll();
    const nowMs = referenceTime.getTime();
    return schedules.filter((item) => {
      if (item.status !== "active" || !item.nextRunAt) {
        return false;
      }

      return new Date(item.nextRunAt).getTime() <= nowMs;
    });
  }

  async update(id: string, patch: Partial<TaskSchedule>): Promise<TaskSchedule | null> {
    const schedules = await this.readAll();
    const target = schedules.find((item) => item.id === id);
    if (!target) {
      return null;
    }

    Object.assign(target, patch, { updatedAt: new Date().toISOString() });
    await this.writeAll(schedules);
    return target;
  }

  async markTriggered(args: {
    scheduleId: string;
    taskId: string;
    triggeredAt?: string;
  }): Promise<TaskSchedule | null> {
    const schedules = await this.readAll();
    const target = schedules.find((item) => item.id === args.scheduleId);
    if (!target) {
      return null;
    }

    const triggeredAt = args.triggeredAt ?? new Date().toISOString();
    target.lastRunAt = triggeredAt;
    target.lastTaskId = args.taskId;
    target.totalRuns += 1;
    target.updatedAt = triggeredAt;

    if (target.kind === "once") {
      target.status = "completed";
      target.nextRunAt = undefined;
    } else {
      target.nextRunAt = nowPlusMinutes(target.everyMinutes ?? 0, triggeredAt);
    }

    await this.writeAll(schedules);
    return target;
  }

  private async readAll(): Promise<TaskSchedule[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as TaskSchedule[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async writeAll(schedules: TaskSchedule[]): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(schedules, null, 2)}\n`, "utf8");
  }
}

function nowPlusMinutes(minutes: number, referenceTime = new Date().toISOString()): string {
  const referenceMs = new Date(referenceTime).getTime();
  return new Date(referenceMs + minutes * 60_000).toISOString();
}
