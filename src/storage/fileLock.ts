import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function tryAcquireLock(lockPath: string): Promise<boolean> {
  try {
    await mkdir(dirname(lockPath), { recursive: true });
    const handle = await open(lockPath, "wx");
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }

    throw error;
  }
}

async function clearStaleLock(lockPath: string, staleAfterMs: number): Promise<void> {
  try {
    const metadata = await stat(lockPath);
    if (Date.now() - metadata.mtimeMs > staleAfterMs) {
      await rm(lockPath, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export async function withFileLock<T>(args: {
  filePath: string;
  timeoutMs?: number;
  staleAfterMs?: number;
  task: () => Promise<T>;
}): Promise<T> {
  const lockPath = `${args.filePath}.lock`;
  const timeoutMs = args.timeoutMs ?? 4_000;
  const staleAfterMs = args.staleAfterMs ?? 30_000;
  const startedAt = Date.now();

  while (!(await tryAcquireLock(lockPath))) {
    await clearStaleLock(lockPath, staleAfterMs);
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for lock ${lockPath}.`);
    }
    await sleep(50);
  }

  try {
    return await args.task();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function readJsonFileOrDefault<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
