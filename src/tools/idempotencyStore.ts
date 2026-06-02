import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type IdempotencyCache = Record<string, unknown>;

function buildKey(toolName: string, key: string): string {
  return `${toolName}:${key}`;
}

export class FileIdempotencyStore {
  constructor(private readonly filePath = resolve(process.cwd(), ".agent-idempotency.json")) {}

  async get<TResult>(toolName: string, key: string): Promise<TResult | null> {
    const cache = await this.readAll();
    return (cache[buildKey(toolName, key)] as TResult | undefined) ?? null;
  }

  async save<TResult>(toolName: string, key: string, value: TResult): Promise<void> {
    const cache = await this.readAll();
    cache[buildKey(toolName, key)] = value;
    await writeFile(this.filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  }

  private async readAll(): Promise<IdempotencyCache> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as IdempotencyCache;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }

      throw error;
    }
  }
}
