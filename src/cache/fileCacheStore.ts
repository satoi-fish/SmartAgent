import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface CacheEnvelope {
  expiresAt: number;
  value: unknown;
}

type CacheFileShape = Record<string, CacheEnvelope>;

export class FileCacheStore {
  constructor(
    private readonly filePath = resolve(process.cwd(), ".agent-cache.json"),
    private readonly onEvent?: (event: { key: string; status: "hit" | "miss" | "write" }) => void,
  ) {}

  async get<T>(key: string): Promise<T | null> {
    const cache = await this.readAll();
    const entry = cache[key];
    if (!entry) {
      this.onEvent?.({ key, status: "miss" });
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      delete cache[key];
      await this.writeAll(cache);
      this.onEvent?.({ key, status: "miss" });
      return null;
    }

    this.onEvent?.({ key, status: "hit" });
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const cache = await this.readAll();
    cache[key] = {
      expiresAt: Date.now() + ttlMs,
      value,
    };
    await this.writeAll(cache);
    this.onEvent?.({ key, status: "write" });
  }

  private async readAll(): Promise<CacheFileShape> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CacheFileShape;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }

      throw error;
    }
  }

  private async writeAll(cache: CacheFileShape): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  }
}
