import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { readJsonFileOrDefault, withFileLock, writeJsonFile } from "../storage/fileLock.js";
import type { ScheduleKind, ScheduleStatus, TaskSchedule } from "../types/index.js";

const SCHEDULE_CLAIM_TTL_MS = 5 * 60_000;

export class ScheduleStore {
  constructor(private readonly filePath = resolve(process.cwd(), ".agent-schedules.json")) {}

  async create(args: {
    prompt: string;
    kind: ScheduleKind;
    runAt?: string;
    everyMinutes?: number;
    approvalId?: string;
  }): Promise<TaskSchedule> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const schedules = await this.readAllUnlocked();
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
        await this.writeAllUnlocked(schedules);
        return schedule;
      },
    });
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
      if (item.status !== "active" || !item.nextRunAt || hasActiveClaim(item, nowMs)) {
        return false;
      }

      return new Date(item.nextRunAt).getTime() <= nowMs;
    });
  }

  async claimDue(referenceTime = new Date()): Promise<Array<{ schedule: TaskSchedule; claimId: string }>> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const schedules = await this.readAllUnlocked();
        const now = referenceTime.toISOString();
        const nowMs = referenceTime.getTime();
        const claims: Array<{ schedule: TaskSchedule; claimId: string }> = [];

        for (const schedule of schedules) {
          if (schedule.status !== "active" || !schedule.nextRunAt) {
            continue;
          }

          if (new Date(schedule.nextRunAt).getTime() > nowMs || hasActiveClaim(schedule, nowMs)) {
            continue;
          }

          const claimId = `claim_${randomUUID().slice(0, 10)}`;
          schedule.status = "dispatching";
          schedule.claimId = claimId;
          schedule.claimedAt = now;
          schedule.updatedAt = now;
          claims.push({
            schedule: {
              ...schedule,
            },
            claimId,
          });
        }

        if (claims.length > 0) {
          await this.writeAllUnlocked(schedules);
        }

        return claims;
      },
    });
  }

  async update(id: string, patch: Partial<TaskSchedule>): Promise<TaskSchedule | null> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const schedules = await this.readAllUnlocked();
        const target = schedules.find((item) => item.id === id);
        if (!target) {
          return null;
        }

        Object.assign(target, patch, { updatedAt: new Date().toISOString() });
        await this.writeAllUnlocked(schedules);
        return target;
      },
    });
  }

  async markTriggered(args: {
    scheduleId: string;
    taskId: string;
    claimId: string;
    triggeredAt?: string;
  }): Promise<TaskSchedule | null> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const schedules = await this.readAllUnlocked();
        const target = schedules.find((item) => item.id === args.scheduleId);
        if (!target || target.claimId !== args.claimId) {
          return null;
        }

        const triggeredAt = args.triggeredAt ?? new Date().toISOString();
        target.lastRunAt = triggeredAt;
        target.lastTaskId = args.taskId;
        target.totalRuns += 1;
        target.updatedAt = triggeredAt;
        target.claimId = undefined;
        target.claimedAt = undefined;

        if (target.kind === "once") {
          target.status = "completed";
          target.nextRunAt = undefined;
        } else {
          target.status = "active";
          target.nextRunAt = nowPlusMinutes(target.everyMinutes ?? 0, triggeredAt);
        }

        await this.writeAllUnlocked(schedules);
        return target;
      },
    });
  }

  async releaseClaim(args: { scheduleId: string; claimId: string }): Promise<TaskSchedule | null> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const schedules = await this.readAllUnlocked();
        const target = schedules.find((item) => item.id === args.scheduleId);
        if (!target || target.claimId !== args.claimId) {
          return null;
        }

        target.status = "active";
        target.claimId = undefined;
        target.claimedAt = undefined;
        target.updatedAt = new Date().toISOString();
        await this.writeAllUnlocked(schedules);
        return target;
      },
    });
  }

  private async readAll(): Promise<TaskSchedule[]> {
    return this.readAllUnlocked();
  }

  private async readAllUnlocked(): Promise<TaskSchedule[]> {
    const parsed = await readJsonFileOrDefault<TaskSchedule[]>(this.filePath, []);
    return Array.isArray(parsed)
      ? parsed.map((schedule) => ({
          ...schedule,
          status:
            schedule.status === "dispatching" && !hasActiveClaim(schedule)
              ? "active"
              : schedule.status,
          claimId:
            schedule.status === "dispatching" && !hasActiveClaim(schedule)
              ? undefined
              : schedule.claimId,
          claimedAt:
            schedule.status === "dispatching" && !hasActiveClaim(schedule)
              ? undefined
              : schedule.claimedAt,
        }))
      : [];
  }

  private async writeAllUnlocked(schedules: TaskSchedule[]): Promise<void> {
    await writeJsonFile(this.filePath, schedules);
  }
}

function nowPlusMinutes(minutes: number, referenceTime = new Date().toISOString()): string {
  const referenceMs = new Date(referenceTime).getTime();
  return new Date(referenceMs + minutes * 60_000).toISOString();
}

function hasActiveClaim(schedule: Pick<TaskSchedule, "claimId" | "claimedAt">, nowMs = Date.now()): boolean {
  if (!schedule.claimId || !schedule.claimedAt) {
    return false;
  }

  return nowMs - new Date(schedule.claimedAt).getTime() <= SCHEDULE_CLAIM_TTL_MS;
}
