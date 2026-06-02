import { resolve } from "node:path";

import { runAgent } from "../agent/runAgent.js";
import { FileCacheStore } from "../cache/fileCacheStore.js";
import { buildRuntimeContext } from "../context/buildContext.js";
import { loadAttachments } from "../input/loadAttachments.js";
import { FileKnowledgeStore } from "../knowledge/knowledgeStore.js";
import { createProvider } from "../llm/createProvider.js";
import { FileMemoryStore } from "../memory/memoryStore.js";
import { createSessionStore } from "../memory/sessionStore.js";
import {
  createPlannerBrief,
  emitPlannerReviewerEvents,
  mergeReviewerNotes,
  reviewFinalAnswer,
  reviseAnswerWithReviewer,
} from "../multiagent/plannerReviewer.js";
import { FileLogger } from "../telemetry/fileLogger.js";
import { FileIdempotencyStore } from "../tools/idempotencyStore.js";
import { loadPermissionPolicy } from "../tools/policy.js";
import { createToolRegistry } from "../tools/registry.js";
import type { AgentRunResult, ApprovalMode, ProviderName, TeamMode } from "../types/index.js";
import type { SessionBackend } from "../memory/sessionStore.js";

export interface ExecuteTaskResult extends AgentRunResult {
  runId: string;
  logPath: string;
  model: string;
  provider: string;
}

export async function executeTask(args: {
  prompt: string;
  apiKey?: string;
  providerName: ProviderName;
  mode: ApprovalMode;
  teamMode?: TeamMode;
  attachmentPaths?: string[];
  echoStdout?: boolean;
  persistSession?: boolean;
  sessionFilePath?: string;
  sessionBackend?: SessionBackend;
  sessionId?: string;
}): Promise<ExecuteTaskResult> {
  const provider = createProvider({
    providerName: args.providerName,
    apiKey: args.apiKey,
    env: process.env,
  });

  const logger = new FileLogger({
    echoStdout: args.echoStdout,
  });
  const cacheStore = new FileCacheStore(undefined, (event) => {
    const namespace = event.key.split(":")[0] ?? "unknown";
    logger.emit({
      type: "cache_event",
      key: event.key,
      status: event.status,
      namespace,
    });
  });
  const memoryStore = new FileMemoryStore(undefined, cacheStore);
  const sessionStore = await createSessionStore({
    backend: args.sessionBackend ?? (args.sessionFilePath ? "file" : undefined),
    env: process.env,
    filePath: args.sessionFilePath ?? resolve(process.cwd(), ".agent-session.json"),
    sessionId: args.sessionId,
  });
  const knowledgeStore = new FileKnowledgeStore(undefined, cacheStore);
  const idempotencyStore = new FileIdempotencyStore();
  const toolRegistry = createToolRegistry({ knowledgeStore, memoryStore, idempotencyStore });
  const permissionPolicy = await loadPermissionPolicy();
  const attachments = args.attachmentPaths?.length ? await loadAttachments(args.attachmentPaths) : [];
  if (attachments.length > 0) {
    logger.emit({
      type: "attachments_loaded",
      count: attachments.length,
      files: attachments.map((item) => item.path),
    });
  }

  const runtimeContext = await buildRuntimeContext({
    prompt: args.prompt,
    mode: args.mode,
    provider,
    memoryStore,
    sessionStore,
    knowledgeStore,
  });
  const teamMode = args.teamMode ?? ((process.env.AGENT_TEAM_MODE as TeamMode | undefined) ?? "single");
  logger.emit({
    type: "team_mode",
    mode: teamMode,
  });
  let plannerBriefText = "";

  if (teamMode === "planner_reviewer") {
    const plannerBrief = await createPlannerBrief({
      provider,
      model: runtimeContext.routedModel.model,
      prompt: args.prompt,
      taskIntent: runtimeContext.taskObject.intent,
    });
    emitPlannerReviewerEvents({
      logger,
      brief: plannerBrief,
    });
    plannerBriefText = [
      "",
      "Planner brief:",
      `- Summary: ${plannerBrief.summary}`,
      ...plannerBrief.focusAreas.map((item) => `- Focus: ${item}`),
      ...plannerBrief.toolHints.map((item) => `- Tool hint: ${item}`),
      ...plannerBrief.reviewChecks.map((item) => `- Review check: ${item}`),
    ].join("\n");
  }

  let attempt = 0;
  const candidateModels = [runtimeContext.routedModel.model, ...runtimeContext.fallbackModels];
  let lastError: unknown;
  let result: AgentRunResult | null = null;
  let activeContext = runtimeContext;

  for (const model of candidateModels) {
    activeContext = {
      ...activeContext,
      routedModel: {
        ...activeContext.routedModel,
        model,
      },
    };

    if (model !== runtimeContext.routedModel.model) {
      logger.emit({
        type: "fallback_used",
        from_model: runtimeContext.routedModel.model,
        to_model: model,
        reason: "Switching to a configured fallback model after prior failure.",
      });
    }

    for (let retryIndex = 0; retryIndex <= activeContext.budget.maxRetries; retryIndex += 1) {
      attempt += 1;

      if (retryIndex > 0) {
        logger.emit({
          type: "run_retrying",
          attempt,
          model,
          reason: "Retrying after a provider/model failure.",
        });
      }

      try {
        result = await runAgent({
          provider,
          prompt: plannerBriefText ? `${args.prompt}\n\n${plannerBriefText}` : args.prompt,
          userContents: [
            { type: "input_text", text: plannerBriefText ? `${args.prompt}\n\n${plannerBriefText}` : args.prompt },
            ...attachments.flatMap((item) => (item.content ? [item.content] : [])),
          ],
          runtimeContext: activeContext,
          tools: toolRegistry,
          permissionPolicy,
          logger,
          streamOutput: args.echoStdout ?? false,
        });
        break;
      } catch (error) {
        lastError = error;
        logger.emit({
          type: "run_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result) {
      break;
    }
  }

  if (!result) {
    throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? "Agent run failed.")));
  }

  if (teamMode === "planner_reviewer") {
    const plannerBrief = await createPlannerBrief({
      provider,
      model: activeContext.routedModel.model,
      prompt: args.prompt,
      taskIntent: activeContext.taskObject.intent,
    });
    const reviewReport = await reviewFinalAnswer({
      provider,
      model: activeContext.routedModel.model,
      prompt: args.prompt,
      plannerBrief,
      structuredAnswer: result.structuredAnswer,
    });
    emitPlannerReviewerEvents({
      logger,
      brief: plannerBrief,
      review: reviewReport,
    });

    if (!reviewReport.approved) {
      const revisedStructured = await reviseAnswerWithReviewer({
        provider,
        model: activeContext.routedModel.model,
        prompt: args.prompt,
        plannerBrief,
        reviewReport,
        currentAnswer: result.renderedAnswer,
        citations: result.structuredAnswer.citations,
      });

      result = {
        ...result,
        structuredAnswer: revisedStructured,
        renderedAnswer: mergeReviewerNotes({
          structuredAnswer: revisedStructured,
          reviewReport,
        }),
      };
    }
  }

  if (args.persistSession ?? true) {
    const now = new Date().toISOString();

    await sessionStore.append({
      role: "user",
      text: args.prompt,
      timestamp: now,
    });

    await sessionStore.append({
      role: "assistant",
      text: result.renderedAnswer,
      timestamp: new Date().toISOString(),
    });
  }

  const logPath = await logger.flush({
    prompt: args.prompt,
    answer: result.renderedAnswer,
    toolCalls: result.toolCalls,
    totalTokens: result.usage.totalTokens,
    needsHumanReview: result.structuredAnswer.needs_human_review,
    model: activeContext.routedModel.model,
    provider: activeContext.routedModel.provider,
  });

  return {
    ...result,
    runId: logger.runId,
    logPath,
    model: activeContext.routedModel.model,
    provider: activeContext.routedModel.provider,
  };
}
