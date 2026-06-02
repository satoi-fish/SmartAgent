import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { BackgroundTask, BackgroundTaskStatus, TaskTrigger } from "../types/index.js";

export class TaskQueueStore {
  constructor(private readonly filePath = resolve(process.cwd(), ".agent-tasks.json")) {}

  async enqueue(args: {
    prompt: string;
    approvalId?: string;
    scheduleId?: string;
    trigger?: TaskTrigger;
  }): Promise<BackgroundTask> {
    const tasks = await this.readAll();
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
    await this.writeAll(tasks);
    return task;
  }

  async update(id: string, patch: Partial<BackgroundTask>): Promise<BackgroundTask | null> {
    const tasks = await this.readAll();
    const task = tasks.find((item) => item.id === id);
    if (!task) {
      return null;
    }

    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    await this.writeAll(tasks);
    return task;
  }

  async get(id: string): Promise<BackgroundTask | null> {
    const tasks = await this.readAll();
    return tasks.find((task) => task.id === id) ?? null;
  }

  async list(status?: BackgroundTaskStatus): Promise<BackgroundTask[]> {
    const tasks = await this.readAll();
    return status ? tasks.filter((task) => task.status === status) : tasks;
  }

  async nextQueued(): Promise<BackgroundTask | null> {
    const tasks = await this.readAll();
    return tasks.find((task) => task.status === "queued") ?? null;
  }

  private async readAll(): Promise<BackgroundTask[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as BackgroundTask[];
      return Array.isArray(parsed)
        ? parsed.map((task) => ({
            ...task,
            trigger: task.trigger ?? "manual",
          }))
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async writeAll(tasks: BackgroundTask[]): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
  }
}
