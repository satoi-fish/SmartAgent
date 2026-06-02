import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ConversationTurn } from "../types/index.js";

export type SessionBackend = "file" | "redis" | "postgres";

export interface SessionStore {
  getAll(): Promise<ConversationTurn[]>;
  getRecent(limit: number): Promise<ConversationTurn[]>;
  append(turn: ConversationTurn): Promise<void>;
}

interface SessionStoreFactoryArgs {
  backend?: SessionBackend;
  env?: NodeJS.ProcessEnv;
  filePath?: string;
  maxEntries?: number;
  sessionId?: string;
}

export class FileSessionStore implements SessionStore {
  constructor(
    private readonly filePath = resolve(process.cwd(), ".agent-session.json"),
    private readonly maxEntries = 40,
  ) {}

  async getAll(): Promise<ConversationTurn[]> {
    return this.readAll();
  }

  async getRecent(limit: number): Promise<ConversationTurn[]> {
    const history = await this.readAll();
    return history.slice(-limit);
  }

  async append(turn: ConversationTurn): Promise<void> {
    const history = await this.readAll();
    history.push(turn);
    const trimmed = history.slice(-this.maxEntries);
    await writeFile(this.filePath, `${JSON.stringify(trimmed, null, 2)}\n`, "utf8");
  }

  private async readAll(): Promise<ConversationTurn[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as ConversationTurn[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }
}

export class RedisSessionStore implements SessionStore {
  private readonly clientPromise: Promise<RedisClientLike>;

  constructor(
    private readonly redisUrl: string,
    private readonly sessionId: string,
    private readonly maxEntries = 40,
    private readonly keyPrefix = "agent:session",
  ) {
    this.clientPromise = this.connect();
  }

  async getAll(): Promise<ConversationTurn[]> {
    const client = await this.clientPromise;
    const rows = await client.lRange(this.keyForSession(), 0, -1);
    return rows.flatMap((row) => parseTurn(row));
  }

  async getRecent(limit: number): Promise<ConversationTurn[]> {
    const client = await this.clientPromise;
    const rows = await client.lRange(this.keyForSession(), -limit, -1);
    return rows.flatMap((row) => parseTurn(row));
  }

  async append(turn: ConversationTurn): Promise<void> {
    const client = await this.clientPromise;
    await client.rPush(this.keyForSession(), [JSON.stringify(turn)]);
    await client.lTrim(this.keyForSession(), -this.maxEntries, -1);
  }

  async ready(): Promise<void> {
    await this.clientPromise;
  }

  private async connect(): Promise<RedisClientLike> {
    const module = (await importPackage("redis")) as RedisModuleLike;
    const client = module.createClient({
      url: this.redisUrl,
    });
    if (typeof client.on === "function") {
      client.on("error", () => undefined);
    }
    await client.connect();
    return client;
  }

  private keyForSession(): string {
    return `${this.keyPrefix}:${this.sessionId}`;
  }
}

export class PostgresSessionStore implements SessionStore {
  private readonly clientPromise: Promise<PgClientLike>;
  private readonly initPromise: Promise<void>;

  constructor(
    private readonly connectionString: string,
    private readonly sessionId: string,
    private readonly maxEntries = 40,
    private readonly tableName = "agent_session_turns",
  ) {
    ensureSafeIdentifier(this.tableName, "Postgres table name");
    this.clientPromise = this.connect();
    this.initPromise = this.initialize();
  }

  async getAll(): Promise<ConversationTurn[]> {
    await this.initPromise;
    const client = await this.clientPromise;
    const result = await client.query<ConversationTurnRow>(
      `SELECT role, text, timestamp
       FROM ${this.tableName}
       WHERE session_id = $1
       ORDER BY id ASC`,
      [this.sessionId],
    );
    return result.rows.map(rowToTurn);
  }

  async getRecent(limit: number): Promise<ConversationTurn[]> {
    await this.initPromise;
    const client = await this.clientPromise;
    const result = await client.query<ConversationTurnRow>(
      `SELECT role, text, timestamp
       FROM ${this.tableName}
       WHERE session_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [this.sessionId, limit],
    );
    return result.rows.reverse().map(rowToTurn);
  }

  async append(turn: ConversationTurn): Promise<void> {
    await this.initPromise;
    const client = await this.clientPromise;
    await client.query(
      `INSERT INTO ${this.tableName} (session_id, role, text, timestamp)
       VALUES ($1, $2, $3, $4)`,
      [this.sessionId, turn.role, turn.text, turn.timestamp],
    );

    await client.query(
      `DELETE FROM ${this.tableName}
       WHERE id IN (
         SELECT id
         FROM ${this.tableName}
         WHERE session_id = $1
         ORDER BY id DESC
         OFFSET $2
       )`,
      [this.sessionId, this.maxEntries],
    );
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  private async connect(): Promise<PgClientLike> {
    const module = (await importPackage("pg")) as PgModuleLike;
    const client = new module.Client({
      connectionString: this.connectionString,
    });
    await client.connect();
    return client;
  }

  private async initialize(): Promise<void> {
    const client = await this.clientPromise;
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id BIGSERIAL PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      )`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS ${this.tableName}_session_id_id_idx
       ON ${this.tableName} (session_id, id)`,
    );
  }
}

export async function createSessionStore(
  args: SessionStoreFactoryArgs = {},
): Promise<SessionStore> {
  const env = args.env ?? process.env;
  const backend = args.backend ?? parseSessionBackend(env.AGENT_SESSION_BACKEND);
  const maxEntries = Number(env.AGENT_SESSION_MAX_ENTRIES ?? args.maxEntries ?? 40);
  const sessionId = args.sessionId ?? env.AGENT_SESSION_ID ?? "default";

  switch (backend) {
    case "file":
      return new FileSessionStore(
        args.filePath ?? resolve(process.cwd(), ".agent-session.json"),
        maxEntries,
      );
    case "redis": {
      const redisUrl = env.REDIS_URL ?? env.AGENT_REDIS_URL;
      if (!redisUrl) {
        throw new Error("Redis session backend requires REDIS_URL or AGENT_REDIS_URL.");
      }

      const store = new RedisSessionStore(
        redisUrl,
        sessionId,
        maxEntries,
        env.AGENT_REDIS_SESSION_PREFIX ?? "agent:session",
      );
      await store.ready();
      return store;
    }
    case "postgres": {
      const connectionString = env.POSTGRES_URL ?? env.DATABASE_URL ?? env.AGENT_POSTGRES_URL;
      if (!connectionString) {
        throw new Error(
          "Postgres session backend requires POSTGRES_URL, DATABASE_URL, or AGENT_POSTGRES_URL.",
        );
      }

      const store = new PostgresSessionStore(
        connectionString,
        sessionId,
        maxEntries,
        env.AGENT_POSTGRES_SESSION_TABLE ?? "agent_session_turns",
      );
      await store.ready();
      return store;
    }
    default: {
      const exhaustiveCheck: never = backend;
      throw new Error(`Unsupported session backend: ${exhaustiveCheck}`);
    }
  }
}

function parseSessionBackend(raw: string | undefined): SessionBackend {
  switch (raw) {
    case "redis":
      return "redis";
    case "postgres":
      return "postgres";
    case "file":
    case undefined:
    case "":
      return "file";
    default:
      return "file";
  }
}

function ensureSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a safe SQL identifier.`);
  }
}

function rowToTurn(row: ConversationTurnRow): ConversationTurn {
  return {
    role: row.role,
    text: row.text,
    timestamp:
      row.timestamp instanceof Date ? row.timestamp.toISOString() : new Date(row.timestamp).toISOString(),
  };
}

function parseTurn(raw: string): ConversationTurn[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "role" in parsed &&
      "text" in parsed &&
      "timestamp" in parsed
    ) {
      const turn = parsed as ConversationTurn;
      return [turn];
    }
  } catch {
    return [];
  }

  return [];
}

async function importPackage(specifier: string): Promise<unknown> {
  try {
    const dynamicImport = new Function("s", "return import(s);") as (s: string) => Promise<unknown>;
    return await dynamicImport(specifier);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Optional package "${specifier}" is required for this session backend. Install it before using this backend. Original error: ${reason}`,
    );
  }
}

interface RedisClientLike {
  connect(): Promise<void>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  rPush(key: string, values: string[]): Promise<number>;
  lTrim(key: string, start: number, stop: number): Promise<void>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface RedisModuleLike {
  createClient(options: { url: string }): RedisClientLike;
}

interface PgQueryResultLike<RowT> {
  rows: RowT[];
}

interface PgClientLike {
  connect(): Promise<void>;
  query<RowT = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<PgQueryResultLike<RowT>>;
}

interface PgModuleLike {
  Client: new (options: { connectionString: string }) => PgClientLike;
}

interface ConversationTurnRow {
  role: ConversationTurn["role"];
  text: string;
  timestamp: string | Date;
}
