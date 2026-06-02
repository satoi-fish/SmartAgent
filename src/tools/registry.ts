import { z } from "zod";

import { LocalBrowserManager } from "../browser/localBrowserManager.js";
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

const rememberFactSchema = z.object({
  fact: z.string().min(6),
  tags: z.array(z.string()).default([]),
  idempotency_key: z.string().min(3).optional(),
});

const forgetMemorySchema = z.object({
  memory_id: z.string().min(3),
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
    description: "Capture a screenshot from a local browser session for review or debugging.",
    riskLevel: "low",
    isReadOnly: true,
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
    requiresApproval: () => false,
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
    rememberProjectFactTool,
    forgetProjectMemoryTool,
    listWorkspaceFilesTool,
    readWorkspaceFileTool,
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
