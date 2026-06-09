import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { FileCacheStore } from "../cache/fileCacheStore.js";
import {
  cosineSimilarity,
  createHashedEmbedding,
  lexicalOverlapScore,
  normalizeSemanticText,
} from "../runtime/hashEmbedding.js";
import type { MemoryRecord } from "../types/index.js";

const SEMANTIC_MERGE_THRESHOLD = 0.9;

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

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function buildMemorySemanticText(record: { text: string; tags: string[] }): string {
  return `${record.text}\n${record.tags.join(" ")}`.trim();
}

function rankRecord(query: string, record: MemoryRecord): number {
  const semanticSimilarity = Math.max(
    0,
    cosineSimilarity(
      createHashedEmbedding(query),
      createHashedEmbedding(buildMemorySemanticText(record)),
    ),
  );
  const lexicalScore = lexicalOverlapScore(query, buildMemorySemanticText(record));
  const exactMatchBonus = normalizeSemanticText(record.text).includes(query) ? 0.2 : 0;

  return semanticSimilarity * 0.7 + lexicalScore * 0.3 + exactMatchBonus;
}

function shouldMergeMemory(args: {
  incomingText: string;
  incomingTags: string[];
  existing: MemoryRecord;
}): boolean {
  const normalizedIncoming = normalizeSemanticText(args.incomingText);
  const normalizedExisting = normalizeSemanticText(args.existing.text);

  if (!normalizedIncoming || !normalizedExisting) {
    return false;
  }

  if (normalizedIncoming === normalizedExisting) {
    return true;
  }

  if (
    normalizedIncoming.includes(normalizedExisting) ||
    normalizedExisting.includes(normalizedIncoming)
  ) {
    return true;
  }

  const semanticSimilarity = cosineSimilarity(
    createHashedEmbedding(buildMemorySemanticText({ text: args.incomingText, tags: args.incomingTags })),
    createHashedEmbedding(buildMemorySemanticText(args.existing)),
  );
  const lexicalScore = lexicalOverlapScore(normalizedIncoming, normalizedExisting);
  const sharedTagCount = args.incomingTags.filter((tag) => args.existing.tags.includes(tag)).length;

  return (
    semanticSimilarity >= SEMANTIC_MERGE_THRESHOLD ||
    (semanticSimilarity >= 0.74 && lexicalScore >= 0.7) ||
    (semanticSimilarity >= 0.72 && lexicalScore >= 0.65 && sharedTagCount > 0)
  );
}

export class FileMemoryStore implements MemoryStore {
  private cacheVersion = 0;

  constructor(
    private readonly filePath = resolve(process.cwd(), ".agent-memory.json"),
    private readonly queryCache?: FileCacheStore,
  ) {}

  async search(query: string, limit = 4): Promise<MemoryRecord[]> {
    const normalizedQuery = normalizeSemanticText(query);
    const cacheKey = `memory:${this.cacheVersion}:${normalizedQuery}:${limit}`;
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
        score: rankRecord(normalizedQuery, record),
      }))
      .filter((item) => item.score > 0.1)
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
    const normalizedTags = normalizeTags(input.tags);
    const existing = records.find(
      (record) =>
        record.scope === (input.scope ?? "project") &&
        shouldMergeMemory({
          incomingText: normalizedText,
          incomingTags: normalizedTags,
          existing: record,
        }),
    );

    if (existing) {
      existing.text =
        existing.text.length >= normalizedText.length ? existing.text : normalizedText;
      existing.tags = Array.from(new Set([...existing.tags, ...normalizedTags]));
      existing.updatedAt = new Date().toISOString();
      await this.writeAll(records);
      this.cacheVersion += 1;
      return existing;
    }

    const record: MemoryRecord = {
      id: `mem_${randomUUID().slice(0, 10)}`,
      text: normalizedText,
      tags: normalizedTags,
      scope: input.scope ?? "project",
      updatedAt: new Date().toISOString(),
    };

    records.push(record);
    await this.writeAll(records);
    this.cacheVersion += 1;
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const records = await this.readAll();
    const next = records.filter((record) => record.id !== id);

    if (next.length === records.length) {
      return false;
    }

    await this.writeAll(next);
    this.cacheVersion += 1;
    return true;
  }

  private async readAll(): Promise<MemoryRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as MemoryRecord[];
      return Array.isArray(parsed) ? parsed : [...seedMemory];
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
