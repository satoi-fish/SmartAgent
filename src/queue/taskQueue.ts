import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { readJsonFileOrDefault, withFileLock, writeJsonFile } from "../storage/fileLock.js";
import type { BackgroundTask, BackgroundTaskStatus, TaskTrigger } from "../types/index.js";

export class TaskQueueStore {
  constructor(private readonly filePath = resolve(process.cwd(), ".agent-tasks.json")) {}

  async enqueue(args: {
    prompt: string;
    approvalId?: string;
    scheduleId?: string;
    trigger?: TaskTrigger;
  }): Promise<BackgroundTask> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const tasks = await this.readAllUnlocked();
        const now = new Date().toISOString();
        const task: BackgroundTask = {
          id: `task_${randomUUID().slice(0, 10)}`,
          prompt: args.prompt,
          createdAt: now,
          updatedAt: now,
          status: "queued",
          trigger: args.trigger ?? "manual",
          approvalId: args.approvalId,
          scheduleId: args.scheduleId,
        };
        tasks.push(task);
        await this.writeAllUnlocked(tasks);
        return task;
      },
    });
  }

  async update(id: string, patch: Partial<BackgroundTask>): Promise<BackgroundTask | null> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const tasks = await this.readAllUnlocked();
        const task = tasks.find((item) => item.id === id);
        if (!task) {
          return null;
        }

        Object.assign(task, patch, { updatedAt: new Date().toISOString() });
        await this.writeAllUnlocked(tasks);
        return task;
      },
    });
  }

  async get(id: string): Promise<BackgroundTask | null> {
    const tasks = await this.readAll();
    return tasks.find((task) => task.id === id) ?? null;
  }

  async list(status?: BackgroundTaskStatus): Promise<BackgroundTask[]> {
    const tasks = await this.readAll();
    return status ? tasks.filter((task) => task.status === status) : tasks;
  }

  async claimNextQueued(): Promise<BackgroundTask | null> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const tasks = await this.readAllUnlocked();
        const task = tasks.find((item) => item.status === "queued");
        if (!task) {
          return null;
        }

        task.status = "running";
        task.updatedAt = new Date().toISOString();
        await this.writeAllUnlocked(tasks);
        return {
          ...task,
        };
      },
    });
  }

  async requeueToBack(id: string): Promise<BackgroundTask | null> {
    return await withFileLock({
      filePath: this.filePath,
      task: async () => {
        const tasks = await this.readAllUnlocked();
        const index = tasks.findIndex((item) => item.id === id);
        if (index < 0) {
          return null;
        }

        const [task] = tasks.splice(index, 1);
        task.status = "queued";
        task.updatedAt = new Date().toISOString();
        tasks.push(task);
        await this.writeAllUnlocked(tasks);
        return {
          ...task,
        };
      },
    });
  }

  private async readAll(): Promise<BackgroundTask[]> {
    return this.readAllUnlocked();
  }

  private async readAllUnlocked(): Promise<BackgroundTask[]> {
    const parsed = await readJsonFileOrDefault<BackgroundTask[]>(this.filePath, []);
    return Array.isArray(parsed)
      ? parsed.map((task) => ({
          ...task,
          trigger: task.trigger ?? "manual",
        }))
      : [];
  }

  private async writeAllUnlocked(tasks: BackgroundTask[]): Promise<void> {
    await writeJsonFile(this.filePath, tasks);
  }
}
