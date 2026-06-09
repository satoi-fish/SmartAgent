import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

import type { FileCacheStore } from "../cache/fileCacheStore.js";
import {
  cosineSimilarity,
  createHashedEmbedding,
  lexicalOverlapScore,
  normalizeSemanticText,
} from "../runtime/hashEmbedding.js";
import type { KnowledgeChunk } from "../types/index.js";

const ENABLED_KNOWLEDGE_EXTENSIONS = new Set([".md", ".txt"]);

export interface KnowledgeEntry {
  path: string;
  title: string;
  bytes: number;
  updatedAt: string;
}

export interface KnowledgeStore {
  search(query: string, limit: number): Promise<KnowledgeChunk[]>;
  listEntries(args?: { pathPrefix?: string; query?: string; limit?: number }): Promise<KnowledgeEntry[]>;
  upsertEntry(args: { path: string; content: string }): Promise<KnowledgeEntry>;
  deleteEntry(path: string): Promise<boolean>;
}

interface IndexedChunk extends KnowledgeChunk {
  normalized: string;
  embedding: number[];
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

function semanticScore(query: string, chunk: IndexedChunk): number {
  const normalizedQuery = normalizeSemanticText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const queryEmbedding = createHashedEmbedding(normalizedQuery);
  const lexicalScore = lexicalOverlapScore(
    normalizedQuery,
    `${chunk.title} ${chunk.sourcePath} ${chunk.content}`,
  );
  const exactMatchBonus = chunk.normalized.includes(normalizedQuery) ? 0.18 : 0;
  const semanticSimilarity = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));

  return semanticSimilarity * 0.72 + lexicalScore * 0.28 + exactMatchBonus;
}

export class FileKnowledgeStore implements KnowledgeStore {
  private cache?: IndexedChunk[];
  private cacheVersion = 0;

  constructor(
    private readonly rootDir = resolve(process.cwd(), "knowledge"),
    private readonly queryCache?: FileCacheStore,
  ) {}

  async search(query: string, limit: number): Promise<KnowledgeChunk[]> {
    const normalizedQuery = normalizeSemanticText(query);
    const cacheKey = `knowledge:${this.cacheVersion}:${normalizedQuery}:${limit}`;
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
        score: semanticScore(normalizedQuery, chunk),
      }))
      .filter((chunk) => chunk.score > 0.12)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ normalized, embedding, ...chunk }) => chunk);

    if (this.queryCache) {
      await this.queryCache.set(cacheKey, results, 5 * 60 * 1000);
    }

    return results;
  }

  async listEntries(args: {
    pathPrefix?: string;
    query?: string;
    limit?: number;
  } = {}): Promise<KnowledgeEntry[]> {
    const startDir = this.resolveWithinRoot(args.pathPrefix ?? ".");
    const query = normalizeSemanticText(args.query ?? "");
    const files = await this.walkKnowledgeFiles(startDir);
    const entries: KnowledgeEntry[] = [];

    for (const filePath of files) {
      const relativePath = relative(this.rootDir, filePath);
      if (query && !normalizeSemanticText(relativePath).includes(query)) {
        continue;
      }

      const metadata = await stat(filePath);
      entries.push({
        path: relativePath,
        title: basename(relativePath, extname(relativePath)),
        bytes: metadata.size,
        updatedAt: metadata.mtime.toISOString(),
      });

      if (entries.length >= (args.limit ?? 50)) {
        break;
      }
    }

    return entries;
  }

  async upsertEntry(args: { path: string; content: string }): Promise<KnowledgeEntry> {
    const normalizedPath = extname(args.path) ? args.path : `${args.path}.md`;
    const fullPath = this.resolveWithinRoot(normalizedPath);
    const extension = extname(fullPath).toLowerCase();
    if (!ENABLED_KNOWLEDGE_EXTENSIONS.has(extension)) {
      throw new Error(`Knowledge entries must use one of: ${[...ENABLED_KNOWLEDGE_EXTENSIONS].join(", ")}.`);
    }

    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, args.content.endsWith("\n") ? args.content : `${args.content}\n`, "utf8");
    const metadata = await stat(fullPath);
    this.invalidateIndex();

    return {
      path: relative(this.rootDir, fullPath),
      title: basename(fullPath, extname(fullPath)),
      bytes: metadata.size,
      updatedAt: metadata.mtime.toISOString(),
    };
  }

  async deleteEntry(path: string): Promise<boolean> {
    const fullPath = this.resolveWithinRoot(path);

    try {
      await rm(fullPath);
      this.invalidateIndex();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }

      throw error;
    }
  }

  private invalidateIndex(): void {
    this.cache = undefined;
    this.cacheVersion += 1;
  }

  private resolveWithinRoot(targetPath: string): string {
    const absolute = resolve(this.rootDir, targetPath);
    const rel = relative(this.rootDir, absolute);
    if (rel.startsWith("..") || rel.includes(`${sep}..${sep}`) || rel === "..") {
      throw new Error(`Knowledge path "${targetPath}" escapes the knowledge root.`);
    }

    return absolute;
  }

  private async walkKnowledgeFiles(currentDir: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = resolve(currentDir, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await this.walkKnowledgeFiles(fullPath)));
        continue;
      }

      if (ENABLED_KNOWLEDGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }

    return files.sort((left, right) => left.localeCompare(right));
  }

  private async loadIndex(): Promise<IndexedChunk[]> {
    if (this.cache) {
      return this.cache;
    }

    const files = await this.walkKnowledgeFiles(this.rootDir);
    const chunks: IndexedChunk[] = [];

    for (const fullPath of files) {
      const raw = await readFile(fullPath, "utf8");
      const relativePath = relative(process.cwd(), fullPath);
      const title = basename(fullPath, extname(fullPath));

      for (const [index, chunk] of splitIntoChunks(raw).entries()) {
        const normalized = normalizeSemanticText(chunk);
        chunks.push({
          id: `${title}#${index + 1}`,
          title,
          content: chunk,
          sourcePath: relativePath,
          normalized,
          embedding: createHashedEmbedding(`${title}\n${relativePath}\n${normalized}`),
          score: 0,
        });
      }
    }

    this.cache = chunks;
    return chunks;
  }
}
