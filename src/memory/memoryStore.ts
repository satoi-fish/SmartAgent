import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { FileCacheStore } from "../cache/fileCacheStore.js";
import type { MemoryRecord } from "../types/index.js";

export interface MemoryStore {
  search(query: string, limit?: number): Promise<MemoryRecord[]>;
  save(record: { text: string; tags: string[]; scope?: MemoryRecord["scope"] }): Promise<MemoryRecord>;
  delete(id: string): Promise<boolean>;
}

const seedMemory: MemoryRecord[] = [
  {
    id: "mem_1",
    text: "The team prefers concise status summaries with clear risks and next steps.",
    tags: ["style", "team"],
    scope: "project",
    updatedAt: new Date("2026-01-01").toISOString(),
  },
  {
    id: "mem_2",
    text: "Production changes should require human approval before execution.",
    tags: ["safety", "ops"],
    scope: "project",
    updatedAt: new Date("2026-01-01").toISOString(),
  },
];

function scoreRecord(query: string, record: MemoryRecord): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return 1;
  }

  return terms.reduce((score, term) => {
    if (record.text.toLowerCase().includes(term)) {
      score += 3;
    }
    if (record.tags.some((tag) => tag.toLowerCase().includes(term))) {
      score += 2;
    }
    return score;
  }, 0);
}

export class FileMemoryStore implements MemoryStore {
  constructor(
    private readonly filePath = resolve(process.cwd(), ".agent-memory.json"),
    private readonly queryCache?: FileCacheStore,
  ) {}

  async search(query: string, limit = 4): Promise<MemoryRecord[]> {
    const cacheKey = `memory:${query.toLowerCase().trim()}:${limit}`;
    if (this.queryCache) {
      const cached = await this.queryCache.get<MemoryRecord[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const records = await this.readAll();
    const results = records
      .map((record) => ({
        record,
        score: scoreRecord(query, record),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map((item) => item.record);

    if (this.queryCache) {
      await this.queryCache.set(cacheKey, results, 5 * 60 * 1000);
    }

    return results;
  }

  async save(input: {
    text: string;
    tags: string[];
    scope?: MemoryRecord["scope"];
  }): Promise<MemoryRecord> {
    const records = await this.readAll();
    const normalizedText = input.text.trim();
    const existing = records.find((record) => record.text.toLowerCase() === normalizedText.toLowerCase());

    if (existing) {
      existing.tags = Array.from(new Set([...existing.tags, ...input.tags]));
      existing.updatedAt = new Date().toISOString();
      await this.writeAll(records);
      return existing;
    }

    const record: MemoryRecord = {
      id: `mem_${randomUUID().slice(0, 10)}`,
      text: normalizedText,
      tags: Array.from(new Set(input.tags)),
      scope: input.scope ?? "project",
      updatedAt: new Date().toISOString(),
    };

    records.push(record);
    await this.writeAll(records);
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const records = await this.readAll();
    const next = records.filter((record) => record.id !== id);

    if (next.length === records.length) {
      return false;
    }

    await this.writeAll(next);
    return true;
  }

  private async readAll(): Promise<MemoryRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MemoryRecord[];
      return Array.isArray(parsed) ? parsed : seedMemory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [...seedMemory];
      }

      throw error;
    }
  }

  private async writeAll(records: MemoryRecord[]): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  }
}
