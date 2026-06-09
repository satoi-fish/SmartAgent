import { z } from "zod";

import { LocalBrowserManager } from "../browser/localBrowserManager.js";
import { GitRepositoryService } from "../integrations/git/repository.js";
import { createLogServiceFromEnv } from "../integrations/logs/registry.js";
import type { KnowledgeStore } from "../knowledge/knowledgeStore.js";
import type { MemoryStore } from "../memory/memoryStore.js";
import type { AnyToolDefinition, ApprovalMode, ToolDefinition } from "../types/index.js";
import { FileIdempotencyStore } from "./idempotencyStore.js";
import { ShellAuditStore } from "./shellAuditStore.js";
import { WorkspaceTools } from "./workspaceTools.js";

const projectDocSchema = z.object({
  topic: z.string().min(1),
});

const draftActionSchema = z.object({
  title: z.string().min(3),
  owner: z.string().min(1),
  idempotency_key: z.string().min(3).optional(),
});

const knowledgeSearchSchema = z.object({
  query: z.string().min(2),
  max_results: z.number().int().min(1).max(5).default(3),
});

const memorySearchSchema = z.object({
  query: z.string().min(2),
  max_results: z.number().int().min(1).max(5).default(3),
});

const seqLogQuerySchema = z.object({
  service: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
  request_id: z.string().min(1).optional(),
  deploy_sha: z.string().min(1).optional(),
  levels: z.array(z.enum(["trace", "debug", "info", "warn", "error", "fatal"])).max(6).default([]),
  from_utc: z.string().datetime().optional(),
  to_utc: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

const rememberFactSchema = z.object({
  fact: z.string().min(6),
  tags: z.array(z.string()).default([]),
  idempotency_key: z.string().min(3).optional(),
});

const forgetMemorySchema = z.object({
  memory_id: z.string().min(3),
});

const listKnowledgeEntriesSchema = z.object({
  path_prefix: z.string().default("."),
  query: z.string().optional(),
  max_results: z.number().int().min(1).max(100).default(20),
});

const upsertKnowledgeEntrySchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
});

const deleteKnowledgeEntrySchema = z.object({
  path: z.string().min(1),
});

const queryGitRepositorySchema = z.object({
  cwd: z.string().optional(),
});

const stageGitChangesSchema = z.object({
  cwd: z.string().optional(),
  paths: z.array(z.string().min(1)).min(1).max(50),
});

const createGitCommitSchema = z.object({
  cwd: z.string().optional(),
  message: z.string().min(3),
});

const listWorkspaceFilesSchema = z.object({
  path_prefix: z.string().default("."),
  query: z.string().optional(),
  max_results: z.number().int().min(1).max(50).default(20),
});

const readWorkspaceFileSchema = z.object({
  path: z.string().min(1),
  start_line: z.number().int().min(1).default(1),
  max_lines: z.number().int().min(1).max(200).default(80),
  max_chars: z.number().int().min(200).max(12000).default(4000),
});

const runWorkspaceCommandSchema = z.object({
  action: z.enum(["pwd", "ls", "rg", "git_status", "git_diff"]),
  args: z.array(z.string()).max(20).default([]),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().min(500).max(10000).default(4000),
  max_output_chars: z.number().int().min(200).max(12000).default(4000),
});

const installWorkspaceDependenciesSchema = z.object({
  cwd: z.string().optional(),
  package_manager: z.enum(["auto", "npm", "pnpm", "yarn"]).default("auto"),
  frozen_lockfile: z.boolean().default(false),
  timeout_ms: z.number().int().min(1000).max(600000).default(120000),
  max_output_chars: z.number().int().min(200).max(20000).default(8000),
});

const runWorkspaceTestsSchema = z.object({
  cwd: z.string().optional(),
  package_manager: z.enum(["auto", "npm", "pnpm", "yarn"]).default("auto"),
  script: z.string().min(1).default("auto"),
  timeout_ms: z.number().int().min(1000).max(600000).default(120000),
  max_output_chars: z.number().int().min(200).max(20000).default(8000),
});

const writeWorkspaceFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  mode: z.enum(["overwrite", "append"]).default("overwrite"),
});

const applyWorkspacePatchSchema = z.object({
  patch: z.string().min(1),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().min(1000).max(120000).default(30000),
  max_output_chars: z.number().int().min(200).max(20000).default(8000),
  check_only: z.boolean().default(false),
});

const inspectLocalWebPageSchema = z.object({
  url: z.string().url(),
  timeout_ms: z.number().int().min(500).max(10000).default(4000),
  max_chars: z.number().int().min(200).max(12000).default(4000),
});

const browserOpenSchema = z.object({
  url: z.string().url(),
  session_id: z.string().min(3).optional(),
  timeout_ms: z.number().int().min(500).max(15000).default(5000),
});

const browserSnapshotSchema = z.object({
  session_id: z.string().min(3),
  max_chars: z.number().int().min(200).max(12000).default(4000),
});

const browserClickSchema = z.object({
  session_id: z.string().min(3),
  selector: z.string().min(1),
  timeout_ms: z.number().int().min(500).max(15000).default(5000),
});

const browserTypeSchema = z.object({
  session_id: z.string().min(3),
  selector: z.string().min(1),
  text: z.string(),
  clear_first: z.boolean().default(true),
  timeout_ms: z.number().int().min(500).max(15000).default(5000),
});

const browserScreenshotSchema = z.object({
  session_id: z.string().min(3),
  file_name: z.string().min(1).optional(),
});

const browserCloseSchema = z.object({
  session_id: z.string().min(3),
});

const searchProjectDocsTool: ToolDefinition<
  z.infer<typeof projectDocSchema>,
  { topic: string; summary: string }
> = {
  name: "search_project_docs",
  description: "Look up internal project guidance and return a concise summary.",
  riskLevel: "low",
  isReadOnly: true,
  jsonSchema: {
    type: "object",
    properties: {
      topic: { type: "string" },
    },
    required: ["topic"],
    additionalProperties: false,
  },
  validate(rawArgs) {
    return projectDocSchema.parse(rawArgs);
  },
  requiresApproval: () => false,
  async execute(args) {
    const docs: Record<string, string> = {
      deploy:
        "Deploys happen through CI. Production changes require a release ticket, owner, rollback plan, and approval.",
      incident:
        "During an incident, summarize impact, suspected cause, current mitigation, and next checkpoint.",
    };

    return {
      topic: args.topic,
      summary:
        docs[args.topic.toLowerCase()] ??
        "No exact document found. Use a narrow topic such as deploy or incident.",
    };
  },
  renderForModel(result) {
    return `Project docs for "${result.topic}": ${result.summary}`;
  },
};

function createDraftActionTool(args: {
  idempotencyStore: FileIdempotencyStore;
}): ToolDefinition<
  z.infer<typeof draftActionSchema>,
  { draftId: string; status: string; title: string; owner: string; reused?: boolean }
> {
  return {
    name: "draft_action_item",
    description:
      "Draft a follow-up action item. This simulates a write tool and should usually require approval.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        owner: { type: "string" },
        idempotency_key: { type: "string" },
      },
      required: ["title", "owner"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return draftActionSchema.parse(rawArgs);
    },
    requiresApproval(mode: ApprovalMode) {
      return mode !== "auto";
    },
    async execute(input) {
      if (input.idempotency_key) {
        const cached = await args.idempotencyStore.get<{
          draftId: string;
          status: string;
          title: string;
          owner: string;
        }>("draft_action_item", input.idempotency_key);

        if (cached) {
          return {
            ...cached,
            reused: true,
          };
        }
      }

      const created = {
        draftId: `draft_${Date.now()}`,
        status: "created",
        title: input.title,
        owner: input.owner,
      };

      if (input.idempotency_key) {
        await args.idempotencyStore.save("draft_action_item", input.idempotency_key, created);
      }

      return created;
    },
    renderForModel(result) {
      return result.reused
        ? `Draft action reused: ${result.draftId}, title=${result.title}, owner=${result.owner}`
        : `Draft action created: ${result.draftId}, title=${result.title}, owner=${result.owner}`;
    },
  };
}

export function createToolRegistry(args: {
  knowledgeStore: KnowledgeStore;
  memoryStore: MemoryStore;
  idempotencyStore: FileIdempotencyStore;
}): AnyToolDefinition[] {
  const logService = createLogServiceFromEnv(process.env);
  const gitRepository = new GitRepositoryService(process.env.AGENT_WORKSPACE_ROOT);
  const workspaceTools = new WorkspaceTools(
    process.env.AGENT_WORKSPACE_ROOT,
    new ShellAuditStore(),
  );
  const browserManager = new LocalBrowserManager();
  const searchKnowledgeBaseTool: ToolDefinition<
    z.infer<typeof knowledgeSearchSchema>,
    {
      query: string;
      matches: Array<{ id: string; sourcePath: string; content: string }>;
    }
  > = {
    name: "search_knowledge_base",
    description: "Search the local knowledge base and return the most relevant chunks.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return knowledgeSearchSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      const matches = await args.knowledgeStore.search(input.query, input.max_results);
      return {
        query: input.query,
        matches: matches.map((match) => ({
          id: match.id,
          sourcePath: match.sourcePath,
          content: match.content.slice(0, 280),
        })),
      };
    },
    renderForModel(result) {
      if (result.matches.length === 0) {
        return `Knowledge base search for "${result.query}" returned no matches.`;
      }

      return [
        `Knowledge base results for "${result.query}":`,
        ...result.matches.map(
          (match) => `- ${match.id} (${match.sourcePath}): ${match.content.replace(/\s+/g, " ")}`,
        ),
      ].join("\n");
    },
  };

  const searchLongTermMemoryTool: ToolDefinition<
    z.infer<typeof memorySearchSchema>,
    {
      query: string;
      matches: Array<{ id: string; text: string; tags: string[] }>;
    }
  > = {
    name: "search_long_term_memory",
    description: "Search durable project memory for stable facts, preferences, or rules.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "number" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return memorySearchSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      const matches = await args.memoryStore.search(input.query, input.max_results);
      return {
        query: input.query,
        matches: matches.map((match) => ({
          id: match.id,
          text: match.text,
          tags: match.tags,
        })),
      };
    },
    renderForModel(result) {
      if (result.matches.length === 0) {
        return `No long-term memory matched "${result.query}".`;
      }

      return [
        `Long-term memory for "${result.query}":`,
        ...result.matches.map((match) => `- ${match.id}: ${match.text} [tags: ${match.tags.join(", ")}]`),
      ].join("\n");
    },
  };

  const querySeqLogsTool: ToolDefinition<
    z.infer<typeof seqLogQuerySchema>,
    {
      provider: string;
      filterExpression?: string;
      total: number;
      entries: Array<{
        id: string;
        timestamp: string;
        level: string;
        service: string;
        environment?: string;
        message: string;
        traceId?: string;
        requestId?: string;
        deploySha?: string;
      }>;
      summary: Array<{ fingerprint: string; count: number; sampleIds: string[] }>;
    }
  > = {
    name: "query_seq_logs",
    description:
      "Query a configured Seq log server for recent events by service, time range, text, trace id, request id, deploy sha, or level.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        service: { type: "string" },
        environment: { type: "string" },
        text: { type: "string" },
        trace_id: { type: "string" },
        request_id: { type: "string" },
        deploy_sha: { type: "string" },
        levels: {
          type: "array",
          items: {
            type: "string",
            enum: ["trace", "debug", "info", "warn", "error", "fatal"],
          },
        },
        from_utc: { type: "string" },
        to_utc: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    validate(rawArgs) {
      return seqLogQuerySchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      if (!logService) {
        throw new Error("Seq log integration is not configured. Set AGENT_LOG_PLATFORM=seq and SEQ_BASE_URL first.");
      }

      const result = await logService.searchLogs({
        service: input.service,
        environment: input.environment,
        text: input.text,
        traceId: input.trace_id,
        requestId: input.request_id,
        deploySha: input.deploy_sha,
        levels: input.levels.length > 0 ? input.levels : undefined,
        limit: input.limit,
        timeRange:
          input.from_utc || input.to_utc
            ? {
                from: input.from_utc,
                to: input.to_utc,
              }
            : undefined,
      });

      return {
        provider: result.provider,
        filterExpression: result.filterExpression,
        total: result.total,
        entries: result.entries.map((entry) => ({
          id: entry.id,
          timestamp: entry.timestamp,
          level: entry.level,
          service: entry.service,
          environment: entry.environment,
          message: entry.message,
          traceId: entry.traceId,
          requestId: entry.requestId,
          deploySha: entry.deploySha,
        })),
        summary: result.summary,
      };
    },
    renderForModel(result) {
      const summaryLines = result.summary.length
        ? result.summary.map((item) => `- ${item.count}x ${item.fingerprint}`).join("\n")
        : "- none";
      const entryLines = result.entries.length
        ? result.entries
            .slice(0, 10)
            .map(
              (entry) =>
                `- [${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.service}${
                  entry.environment ? ` (${entry.environment})` : ""
                }: ${entry.message}${
                  entry.traceId ? ` | trace=${entry.traceId}` : ""
                }${entry.requestId ? ` | request=${entry.requestId}` : ""}${
                  entry.deploySha ? ` | deploy=${entry.deploySha}` : ""
                }`,
            )
            .join("\n")
        : "- none";

      return [
        `Log provider: ${result.provider}`,
        `Matched entries: ${result.total}`,
        result.filterExpression ? `Seq filter: ${result.filterExpression}` : "Seq filter: <none>",
        `Top patterns:\n${summaryLines}`,
        `Entries:\n${entryLines}`,
      ].join("\n\n");
    },
    toEventData(result) {
      return {
        provider: result.provider,
        filterExpression: result.filterExpression,
        total: result.total,
        summary: result.summary.slice(0, 5).map((item) => ({
          fingerprint: item.fingerprint,
          count: item.count,
        })),
        entries: result.entries.slice(0, 5).map((entry) => ({
          timestamp: entry.timestamp,
          level: entry.level,
          service: entry.service,
          environment: entry.environment,
          message: entry.message,
          traceId: entry.traceId,
          requestId: entry.requestId,
          deploySha: entry.deploySha,
        })),
      };
    },
  };

  const listKnowledgeEntriesTool: ToolDefinition<
    z.infer<typeof listKnowledgeEntriesSchema>,
    {
      entries: Array<{ path: string; title: string; bytes: number; updatedAt: string }>;
    }
  > = {
    name: "list_knowledge_entries",
    description: "List knowledge-base documents that the agent can retrieve and cite.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        path_prefix: { type: "string" },
        query: { type: "string" },
        max_results: { type: "number" },
      },
      additionalProperties: false,
    },
    validate(rawArgs) {
      return listKnowledgeEntriesSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return {
        entries: await args.knowledgeStore.listEntries({
          pathPrefix: input.path_prefix,
          query: input.query,
          limit: input.max_results,
        }),
      };
    },
    renderForModel(result) {
      return result.entries.length
        ? [
            "Knowledge entries:",
            ...result.entries.map(
              (entry) =>
                `- ${entry.path} (${entry.bytes} bytes, updated ${entry.updatedAt}): ${entry.title}`,
            ),
          ].join("\n")
        : "No knowledge entries matched the requested filters.";
    },
  };

  const queryGitRepositoryTool: ToolDefinition<
    z.infer<typeof queryGitRepositorySchema>,
    {
      root: string;
      cwd: string;
      branch: string;
      ahead: number;
      behind: number;
      isClean: boolean;
      changedFiles: Array<{ path: string; indexStatus: string; workTreeStatus: string }>;
    }
  > = {
    name: "query_git_repository",
    description: "Inspect the current git repository status, branch state, and changed files.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
      },
      additionalProperties: false,
    },
    validate(rawArgs) {
      return queryGitRepositorySchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return await gitRepository.getSummary(input.cwd);
    },
    renderForModel(result) {
      return [
        `Branch: ${result.branch}`,
        `Ahead/behind: +${result.ahead} / -${result.behind}`,
        `Repository clean: ${result.isClean ? "yes" : "no"}`,
        result.changedFiles.length
          ? `Changed files:\n${result.changedFiles
              .map((file) => `- ${file.indexStatus}${file.workTreeStatus} ${file.path}`)
              .join("\n")}`
          : "Changed files: none",
      ].join("\n\n");
    },
    toEventData(result) {
      return {
        branch: result.branch,
        ahead: result.ahead,
        behind: result.behind,
        isClean: result.isClean,
        changedFiles: result.changedFiles.slice(0, 10),
      };
    },
  };

  const upsertKnowledgeEntryTool: ToolDefinition<
    z.infer<typeof upsertKnowledgeEntrySchema>,
    { path: string; title: string; bytes: number; updatedAt: string }
  > = {
    name: "upsert_knowledge_entry",
    description: "Create or replace a knowledge-base document so future runs can retrieve it.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return upsertKnowledgeEntrySchema.parse(rawArgs);
    },
    requiresApproval(mode: ApprovalMode) {
      return mode !== "auto";
    },
    async execute(input) {
      return await args.knowledgeStore.upsertEntry({
        path: input.path,
        content: input.content,
      });
    },
    renderForModel(result) {
      return `Knowledge entry saved at ${result.path} (${result.bytes} bytes, updated ${result.updatedAt}).`;
    },
  };

  const deleteKnowledgeEntryTool: ToolDefinition<
    z.infer<typeof deleteKnowledgeEntrySchema>,
    { path: string; removed: boolean }
  > = {
    name: "delete_knowledge_entry",
    description: "Delete a knowledge-base document that is outdated or incorrect.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return deleteKnowledgeEntrySchema.parse(rawArgs);
    },
    requiresApproval(mode: ApprovalMode) {
      return mode !== "auto";
    },
    async execute(input) {
      return {
        path: input.path,
        removed: await args.knowledgeStore.deleteEntry(input.path),
      };
    },
    renderForModel(result) {
      return result.removed
        ? `Deleted knowledge entry ${result.path}.`
        : `No knowledge entry matched ${result.path}.`;
    },
  };

  const stageGitChangesTool: ToolDefinition<
    z.infer<typeof stageGitChangesSchema>,
    {
      root: string;
      cwd: string;
      branch: string;
      ahead: number;
      behind: number;
      isClean: boolean;
      changedFiles: Array<{ path: string; indexStatus: string; workTreeStatus: string }>;
    }
  > = {
    name: "stage_git_changes",
    description: "Stage one or more workspace paths with git add.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["paths"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return stageGitChangesSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await gitRepository.stagePaths({
        cwd: input.cwd,
        paths: input.paths,
      });
    },
    renderForModel(result) {
      return `Staged requested paths on branch ${result.branch}. Repository is ${result.isClean ? "clean" : "dirty"} with ${result.changedFiles.length} changed file(s).`;
    },
    toEventData(result) {
      return {
        branch: result.branch,
        isClean: result.isClean,
        changedFiles: result.changedFiles.slice(0, 10),
      };
    },
  };

  const createGitCommitTool: ToolDefinition<
    z.infer<typeof createGitCommitSchema>,
    {
      root: string;
      cwd: string;
      branch: string;
      ahead: number;
      behind: number;
      isClean: boolean;
      changedFiles: Array<{ path: string; indexStatus: string; workTreeStatus: string }>;
    }
  > = {
    name: "create_git_commit",
    description: "Create a git commit from the currently staged changes using a provided message.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        message: { type: "string" },
      },
      required: ["message"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return createGitCommitSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await gitRepository.createCommit({
        cwd: input.cwd,
        message: input.message,
      });
    },
    renderForModel(result) {
      return `Created commit on branch ${result.branch}. Ahead by ${result.ahead}, behind by ${result.behind}. Repository is ${result.isClean ? "clean" : "dirty"}.`;
    },
    toEventData(result) {
      return {
        branch: result.branch,
        ahead: result.ahead,
        behind: result.behind,
        isClean: result.isClean,
      };
    },
  };

  const rememberProjectFactTool: ToolDefinition<
    z.infer<typeof rememberFactSchema>,
    { id: string; text: string; tags: string[]; reused?: boolean }
  > = {
    name: "remember_project_fact",
    description: "Persist a stable project fact or preference into long-term memory.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        fact: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        idempotency_key: { type: "string" },
      },
      required: ["fact"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return rememberFactSchema.parse(rawArgs);
    },
    requiresApproval(mode: ApprovalMode) {
      return mode !== "auto";
    },
    async execute(input) {
      if (input.idempotency_key) {
        const cached = await args.idempotencyStore.get<{
          id: string;
          text: string;
          tags: string[];
        }>("remember_project_fact", input.idempotency_key);

        if (cached) {
          return {
            ...cached,
            reused: true,
          };
        }
      }

      const record = await args.memoryStore.save({
        text: input.fact,
        tags: input.tags,
        scope: "project",
      });
      const result = {
        id: record.id,
        text: record.text,
        tags: record.tags,
      };

      if (input.idempotency_key) {
        await args.idempotencyStore.save("remember_project_fact", input.idempotency_key, result);
      }

      return result;
    },
    renderForModel(result) {
      return result.reused
        ? `Reused long-term memory ${result.id}: ${result.text}`
        : `Stored long-term memory ${result.id}: ${result.text}`;
    },
  };

  const forgetProjectMemoryTool: ToolDefinition<
    z.infer<typeof forgetMemorySchema>,
    { memory_id: string; removed: boolean }
  > = {
    name: "forget_project_memory",
    description: "Delete an outdated long-term memory record by id.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string" },
      },
      required: ["memory_id"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return forgetMemorySchema.parse(rawArgs);
    },
    requiresApproval(mode: ApprovalMode) {
      return mode !== "auto";
    },
    async execute(input) {
      return {
        memory_id: input.memory_id,
        removed: await args.memoryStore.delete(input.memory_id),
      };
    },
    renderForModel(result) {
      return result.removed
        ? `Deleted long-term memory ${result.memory_id}.`
        : `No long-term memory matched ${result.memory_id}.`;
    },
  };

  const listWorkspaceFilesTool: ToolDefinition<
    z.infer<typeof listWorkspaceFilesSchema>,
    { files: string[]; root: string }
  > = {
    name: "list_workspace_files",
    description: "List files in the current workspace for IDE-style navigation and code inspection.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        path_prefix: { type: "string" },
        query: { type: "string" },
        max_results: { type: "number" },
      },
      additionalProperties: false,
    },
    validate(rawArgs) {
      return listWorkspaceFilesSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      const files = await workspaceTools.listFiles({
        pathPrefix: input.path_prefix,
        query: input.query,
        maxResults: input.max_results,
      });
      return {
        files,
        root: process.env.AGENT_WORKSPACE_ROOT ?? process.cwd(),
      };
    },
    renderForModel(result) {
      return result.files.length
        ? [`Workspace files under ${result.root}:`, ...result.files.map((item) => `- ${item}`)].join("\n")
        : `No workspace files matched the requested filters under ${result.root}.`;
    },
  };

  const readWorkspaceFileTool: ToolDefinition<
    z.infer<typeof readWorkspaceFileSchema>,
    { path: string; content: string; startLine: number; endLine: number; truncated: boolean }
  > = {
    name: "read_workspace_file",
    description: "Read a text file from the workspace with line and size limits.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        max_lines: { type: "number" },
        max_chars: { type: "number" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return readWorkspaceFileSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return await workspaceTools.readTextFile({
        path: input.path,
        startLine: input.start_line,
        maxLines: input.max_lines,
        maxChars: input.max_chars,
      });
    },
    renderForModel(result) {
      const suffix = result.truncated ? "\n[truncated]" : "";
      return `${result.path}:${result.startLine}-${result.endLine}\n${result.content}${suffix}`;
    },
  };

  const runWorkspaceCommandTool: ToolDefinition<
    z.infer<typeof runWorkspaceCommandSchema>,
    {
      command: string;
      args: string[];
      cwd: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      truncated: boolean;
    }
  > = {
    name: "run_workspace_command",
    description:
      "Run a tightly scoped workspace shell command for engineering investigation. This is audited and should usually require approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["pwd", "ls", "rg", "git_status", "git_diff"] },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        timeout_ms: { type: "number" },
        max_output_chars: { type: "number" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return runWorkspaceCommandSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await workspaceTools.runCommand({
        action: input.action,
        commandArgs: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeout_ms,
        maxOutputChars: input.max_output_chars,
      });
    },
    renderForModel(result) {
      return [
        `Command: ${result.command} ${result.args.join(" ")}`.trim(),
        `cwd: ${result.cwd}`,
        `exit_code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
        result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>",
        result.truncated ? "output_truncated: yes" : "output_truncated: no",
      ].join("\n\n");
    },
  };

  const installWorkspaceDependenciesTool: ToolDefinition<
    z.infer<typeof installWorkspaceDependenciesSchema>,
    {
      command: string;
      args: string[];
      cwd: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      truncated: boolean;
      packageManager: "npm" | "pnpm" | "yarn";
    }
  > = {
    name: "install_workspace_dependencies",
    description:
      "Install workspace dependencies using the detected package manager. This can change lockfiles and node_modules, so it requires approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        package_manager: { type: "string", enum: ["auto", "npm", "pnpm", "yarn"] },
        frozen_lockfile: { type: "boolean" },
        timeout_ms: { type: "number" },
        max_output_chars: { type: "number" },
      },
      additionalProperties: false,
    },
    validate(rawArgs) {
      return installWorkspaceDependenciesSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await workspaceTools.installDependencies({
        cwd: input.cwd,
        packageManager: input.package_manager,
        frozenLockfile: input.frozen_lockfile,
        timeoutMs: input.timeout_ms,
        maxOutputChars: input.max_output_chars,
      });
    },
    renderForModel(result) {
      return [
        `Package manager: ${result.packageManager}`,
        `Command: ${result.command} ${result.args.join(" ")}`.trim(),
        `cwd: ${result.cwd}`,
        `exit_code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
        result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>",
      ].join("\n\n");
    },
    toEventData(result) {
      return {
        packageManager: result.packageManager,
        exitCode: result.exitCode,
        cwd: result.cwd,
      };
    },
  };

  const runWorkspaceTestsTool: ToolDefinition<
    z.infer<typeof runWorkspaceTestsSchema>,
    {
      command: string;
      args: string[];
      cwd: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      truncated: boolean;
      packageManager: "npm" | "pnpm" | "yarn";
      script: string;
    }
  > = {
    name: "run_workspace_tests",
    description:
      "Run a workspace test-like script such as test, check, lint, or evals. This executes code and requires approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        cwd: { type: "string" },
        package_manager: { type: "string", enum: ["auto", "npm", "pnpm", "yarn"] },
        script: { type: "string" },
        timeout_ms: { type: "number" },
        max_output_chars: { type: "number" },
      },
      additionalProperties: false,
    },
    validate(rawArgs) {
      return runWorkspaceTestsSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await workspaceTools.runTests({
        cwd: input.cwd,
        packageManager: input.package_manager,
        script: input.script,
        timeoutMs: input.timeout_ms,
        maxOutputChars: input.max_output_chars,
      });
    },
    renderForModel(result) {
      return [
        `Package manager: ${result.packageManager}`,
        `Script: ${result.script}`,
        `Command: ${result.command} ${result.args.join(" ")}`.trim(),
        `cwd: ${result.cwd}`,
        `exit_code: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
        result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>",
      ].join("\n\n");
    },
    toEventData(result) {
      return {
        packageManager: result.packageManager,
        script: result.script,
        exitCode: result.exitCode,
        cwd: result.cwd,
      };
    },
  };

  const writeWorkspaceFileTool: ToolDefinition<
    z.infer<typeof writeWorkspaceFileSchema>,
    { path: string; mode: "overwrite" | "append"; bytesWritten: number; created: boolean }
  > = {
    name: "write_workspace_file",
    description:
      "Write or append text content to a workspace file. This is a direct code/content edit and requires approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        mode: { type: "string", enum: ["overwrite", "append"] },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return writeWorkspaceFileSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await workspaceTools.writeTextFile({
        path: input.path,
        content: input.content,
        mode: input.mode,
      });
    },
    renderForModel(result) {
      return `Wrote ${result.bytesWritten} bytes to ${result.path} using ${result.mode} mode (${result.created ? "created" : "updated"}).`;
    },
    toEventData(result) {
      return {
        path: result.path,
        mode: result.mode,
        bytesWritten: result.bytesWritten,
        created: result.created,
      };
    },
  };

  const applyWorkspacePatchTool: ToolDefinition<
    z.infer<typeof applyWorkspacePatchSchema>,
    {
      cwd: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      applied: boolean;
      validatedPaths: string[];
    }
  > = {
    name: "apply_workspace_patch",
    description:
      "Apply a unified diff patch inside the workspace after validating that all touched paths stay within the repo. This requires approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        patch: { type: "string" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" },
        max_output_chars: { type: "number" },
        check_only: { type: "boolean" },
      },
      required: ["patch"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return applyWorkspacePatchSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await workspaceTools.applyPatch({
        patch: input.patch,
        cwd: input.cwd,
        timeoutMs: input.timeout_ms,
        maxOutputChars: input.max_output_chars,
        checkOnly: input.check_only,
      });
    },
    renderForModel(result) {
      return [
        `cwd: ${result.cwd}`,
        `exit_code: ${result.exitCode}`,
        `applied: ${result.applied ? "yes" : "no"}`,
        `validated_paths:\n${result.validatedPaths.map((path) => `- ${path}`).join("\n")}`,
        result.stdout ? `stdout:\n${result.stdout}` : "stdout: <empty>",
        result.stderr ? `stderr:\n${result.stderr}` : "stderr: <empty>",
      ].join("\n\n");
    },
    toEventData(result) {
      return {
        cwd: result.cwd,
        exitCode: result.exitCode,
        applied: result.applied,
        validatedPaths: result.validatedPaths,
      };
    },
  };

  const inspectLocalWebPageTool: ToolDefinition<
    z.infer<typeof inspectLocalWebPageSchema>,
    {
      url: string;
      status: number;
      contentType: string;
      title: string | null;
      bodyPreview: string;
      truncated: boolean;
    }
  > = {
    name: "inspect_local_web_page",
    description:
      "Fetch a localhost or other explicitly allowed local web page and return a compact preview for browser-style inspection.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeout_ms: { type: "number" },
        max_chars: { type: "number" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return inspectLocalWebPageSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return await workspaceTools.inspectLocalWebPage({
        url: input.url,
        timeoutMs: input.timeout_ms,
        maxChars: input.max_chars,
      });
    },
    renderForModel(result) {
      return [
        `URL: ${result.url}`,
        `Status: ${result.status}`,
        `Content-Type: ${result.contentType}`,
        `Title: ${result.title ?? "none"}`,
        `Preview:\n${result.bodyPreview}`,
      ].join("\n\n");
    },
  };

  const browserOpenLocalPageTool: ToolDefinition<
    z.infer<typeof browserOpenSchema>,
    { sessionId: string; url: string; title: string }
  > = {
    name: "browser_open_local_page",
    description:
      "Open a local/dev web page in a controlled browser session and return a session id for follow-up inspection.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        session_id: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["url"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return browserOpenSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return await browserManager.openPage({
        url: input.url,
        sessionId: input.session_id,
        timeoutMs: input.timeout_ms,
      });
    },
    renderForModel(result) {
      return `Browser session ${result.sessionId} opened at ${result.url} (title: ${result.title}).`;
    },
  };

  const browserSnapshotLocalPageTool: ToolDefinition<
    z.infer<typeof browserSnapshotSchema>,
    {
      sessionId: string;
      url: string;
      title: string;
      bodyPreview: string;
      truncated: boolean;
    }
  > = {
    name: "browser_snapshot_local_page",
    description: "Read the current title and body preview from an existing local browser session.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        max_chars: { type: "number" },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return browserSnapshotSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return await browserManager.snapshot({
        sessionId: input.session_id,
        maxChars: input.max_chars,
      });
    },
    renderForModel(result) {
      const truncated = result.truncated ? "\n[truncated]" : "";
      return [
        `Session: ${result.sessionId}`,
        `URL: ${result.url}`,
        `Title: ${result.title}`,
        `Body preview:\n${result.bodyPreview}${truncated}`,
      ].join("\n\n");
    },
  };

  const browserClickLocalElementTool: ToolDefinition<
    z.infer<typeof browserClickSchema>,
    { sessionId: string; url: string; title: string }
  > = {
    name: "browser_click_local_element",
    description:
      "Click an element in a local browser session. This can trigger side effects and should require approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        selector: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["session_id", "selector"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return browserClickSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await browserManager.click({
        sessionId: input.session_id,
        selector: input.selector,
        timeoutMs: input.timeout_ms,
      });
    },
    renderForModel(result) {
      return `Clicked element. Session ${result.sessionId} is now at ${result.url} (title: ${result.title}).`;
    },
  };

  const browserTypeLocalElementTool: ToolDefinition<
    z.infer<typeof browserTypeSchema>,
    { sessionId: string; url: string; title: string }
  > = {
    name: "browser_type_local_element",
    description:
      "Type into an element in a local browser session. This can change application state and should require approval.",
    riskLevel: "high",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        selector: { type: "string" },
        text: { type: "string" },
        clear_first: { type: "boolean" },
        timeout_ms: { type: "number" },
      },
      required: ["session_id", "selector", "text"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return browserTypeSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await browserManager.type({
        sessionId: input.session_id,
        selector: input.selector,
        text: input.text,
        timeoutMs: input.timeout_ms,
        clearFirst: input.clear_first,
      });
    },
    renderForModel(result) {
      return `Typed into element. Session ${result.sessionId} is now at ${result.url} (title: ${result.title}).`;
    },
  };

  const browserScreenshotLocalPageTool: ToolDefinition<
    z.infer<typeof browserScreenshotSchema>,
    { sessionId: string; url: string; screenshotPath: string }
  > = {
    name: "browser_screenshot_local_page",
    description:
      "Capture a screenshot from a local browser session and save it into the agent screenshot directory.",
    riskLevel: "medium",
    isReadOnly: false,
    jsonSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        file_name: { type: "string" },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return browserScreenshotSchema.parse(rawArgs);
    },
    requiresApproval() {
      return true;
    },
    async execute(input) {
      return await browserManager.screenshot({
        sessionId: input.session_id,
        fileName: input.file_name,
      });
    },
    renderForModel(result) {
      return `Saved browser screenshot for session ${result.sessionId} at ${result.screenshotPath}.`;
    },
  };

  const browserCloseLocalSessionTool: ToolDefinition<
    z.infer<typeof browserCloseSchema>,
    { sessionId: string; closed: boolean }
  > = {
    name: "browser_close_local_session",
    description: "Close an existing local browser session and release its resources.",
    riskLevel: "low",
    isReadOnly: true,
    jsonSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
      additionalProperties: false,
    },
    validate(rawArgs) {
      return browserCloseSchema.parse(rawArgs);
    },
    requiresApproval: () => false,
    async execute(input) {
      return await browserManager.close({
        sessionId: input.session_id,
      });
    },
    renderForModel(result) {
      return result.closed
        ? `Closed browser session ${result.sessionId}.`
        : `Browser session ${result.sessionId} was already closed or missing.`;
    },
  };

  return [
    searchProjectDocsTool,
    searchKnowledgeBaseTool,
    searchLongTermMemoryTool,
    ...(logService ? [querySeqLogsTool] : []),
    listKnowledgeEntriesTool,
    queryGitRepositoryTool,
    rememberProjectFactTool,
    forgetProjectMemoryTool,
    upsertKnowledgeEntryTool,
    deleteKnowledgeEntryTool,
    stageGitChangesTool,
    createGitCommitTool,
    listWorkspaceFilesTool,
    readWorkspaceFileTool,
    installWorkspaceDependenciesTool,
    runWorkspaceTestsTool,
    writeWorkspaceFileTool,
    applyWorkspacePatchTool,
    inspectLocalWebPageTool,
    browserOpenLocalPageTool,
    browserSnapshotLocalPageTool,
    browserScreenshotLocalPageTool,
    browserCloseLocalSessionTool,
    browserClickLocalElementTool,
    browserTypeLocalElementTool,
    runWorkspaceCommandTool,
    createDraftActionTool({ idempotencyStore: args.idempotencyStore }),
  ];
}
