import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { FileCacheStore } from "../cache/fileCacheStore.js";
import type { KnowledgeChunk } from "../types/index.js";

export interface KnowledgeStore {
  search(query: string, limit: number): Promise<KnowledgeChunk[]>;
}

interface IndexedChunk extends KnowledgeChunk {
  normalized: string;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitIntoChunks(content: string, maxChars = 700): string[] {
  const paragraphs = content
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;

    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    current = paragraph.slice(0, maxChars);
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function scoreChunk(query: string, chunk: IndexedChunk): number {
  const normalizedQuery = normalize(query);
  const terms = Array.from(
    new Set(normalizedQuery.split(/[\s,.;:!?()[\]{}"']+/).filter((term) => term.length >= 2)),
  );

  let score = 0;

  if (normalizedQuery && chunk.normalized.includes(normalizedQuery)) {
    score += 12;
  }

  for (const term of terms) {
    if (chunk.normalized.includes(term)) {
      score += 3;
    }
    if (normalize(chunk.title).includes(term)) {
      score += 4;
    }
    if (normalize(chunk.sourcePath).includes(term)) {
      score += 4;
    }
  }

  return score;
}

function rerankChunk(query: string, chunk: IndexedChunk): number {
  const normalizedQuery = normalize(query);
  const terms = Array.from(
    new Set(normalizedQuery.split(/[\s,.;:!?()[\]{}"']+/).filter((term) => term.length >= 2)),
  );

  const distinctHits = terms.filter((term) => chunk.normalized.includes(term)).length;
  const exactMatchBonus = normalizedQuery && chunk.normalized.includes(normalizedQuery) ? 8 : 0;
  const titleBonus = terms.filter((term) => normalize(chunk.title).includes(term)).length * 2;
  const firstHitIndex = terms
    .map((term) => chunk.normalized.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const positionBonus = typeof firstHitIndex === "number" ? Math.max(0, 6 - Math.floor(firstHitIndex / 80)) : 0;

  return chunk.score + distinctHits * 3 + exactMatchBonus + titleBonus + positionBonus;
}

export class FileKnowledgeStore implements KnowledgeStore {
  private cache?: IndexedChunk[];

  constructor(
    private readonly rootDir = resolve(process.cwd(), "knowledge"),
    private readonly queryCache?: FileCacheStore,
  ) {}

  async search(query: string, limit: number): Promise<KnowledgeChunk[]> {
    const cacheKey = `knowledge:${query.toLowerCase().trim()}:${limit}`;
    if (this.queryCache) {
      const cached = await this.queryCache.get<KnowledgeChunk[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const index = await this.loadIndex();

    const results = index
      .map((chunk) => ({
        ...chunk,
        score: scoreChunk(query, chunk),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(limit * 3, limit))
      .map((chunk) => ({
        ...chunk,
        score: rerankChunk(query, chunk),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ normalized, ...chunk }) => chunk);

    if (this.queryCache) {
      await this.queryCache.set(cacheKey, results, 5 * 60 * 1000);
    }

    return results;
  }

  private async loadIndex(): Promise<IndexedChunk[]> {
    if (this.cache) {
      return this.cache;
    }

    let fileNames: string[];
    try {
      fileNames = await readdir(this.rootDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = [];
        return this.cache;
      }

      throw error;
    }

    const chunks: IndexedChunk[] = [];

    for (const fileName of fileNames) {
      if (!/\.(md|txt)$/i.test(fileName)) {
        continue;
      }

      const fullPath = resolve(this.rootDir, fileName);
      const raw = await readFile(fullPath, "utf8");
      const title = fileName.replace(/\.[^.]+$/, "");

      for (const [index, chunk] of splitIntoChunks(raw).entries()) {
        chunks.push({
          id: `${title}#${index + 1}`,
          title,
          content: chunk,
          sourcePath: relative(process.cwd(), fullPath),
          normalized: normalize(chunk),
          score: 0,
        });
      }
    }

    this.cache = chunks;
    return chunks;
  }
}
