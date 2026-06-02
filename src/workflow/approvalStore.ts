import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ApprovalRequest, ApprovalStatus, WorkflowPlan } from "../types/index.js";

export class ApprovalStore {
  constructor(private readonly filePath = resolve(process.cwd(), ".agent-approvals.json")) {}

  async create(args: { prompt: string; plan: WorkflowPlan }): Promise<ApprovalRequest> {
    const requests = await this.readAll();
    const now = new Date().toISOString();
    const request: ApprovalRequest = {
      id: `approval_${randomUUID().slice(0, 10)}`,
      createdAt: now,
      updatedAt: now,
      prompt: args.prompt,
      status: "pending",
      plan: args.plan,
    };

    requests.push(request);
    await this.writeAll(requests);
    return request;
  }

  async updateStatus(id: string, status: ApprovalStatus): Promise<ApprovalRequest | null> {
    const requests = await this.readAll();
    const target = requests.find((request) => request.id === id);
    if (!target) {
      return null;
    }

    target.status = status;
    target.updatedAt = new Date().toISOString();
    await this.writeAll(requests);
    return target;
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    const requests = await this.readAll();
    return requests.find((request) => request.id === id) ?? null;
  }

  async list(): Promise<ApprovalRequest[]> {
    return this.readAll();
  }

  private async readAll(): Promise<ApprovalRequest[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ApprovalRequest[];
      return Array.isArray(parsed)
        ? parsed.map((request) => ({
            ...request,
            plan: {
              ...request.plan,
              approvedTools: Array.isArray(request.plan?.approvedTools)
                ? request.plan.approvedTools.filter((item): item is string => typeof item === "string")
                : [],
              steps: Array.isArray(request.plan?.steps)
                ? request.plan.steps.map((step) => ({
                    ...step,
                    toolName: step.toolName,
                  }))
                : [],
            },
          }))
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async writeAll(requests: ApprovalRequest[]): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(requests, null, 2)}\n`, "utf8");
  }
}
