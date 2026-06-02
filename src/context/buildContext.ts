import { buildSystemPrompt } from "../prompts/modules.js";
import { parseTaskObject } from "../tasks/parseTask.js";
import type { MemoryStore } from "../memory/memoryStore.js";
import type { SessionStore } from "../memory/sessionStore.js";
import type { KnowledgeStore } from "../knowledge/knowledgeStore.js";
import { routeModel } from "../llm/router.js";
import type { ApprovalMode, RuntimeContext } from "../types/index.js";
import type { ModelProvider } from "../llm/provider.js";
import { buildFallbackModels, buildRuntimeBudget } from "../runtime/budget.js";
import {
  buildContextPlan,
  compactHistory,
  compactKnowledge,
  compactMemory,
  profileMaxChars,
  summarizeHistory,
} from "./planContext.js";

export async function buildRuntimeContext(args: {
  prompt: string;
  mode: ApprovalMode;
  provider: ModelProvider;
  memoryStore: MemoryStore;
  sessionStore: SessionStore;
  knowledgeStore: KnowledgeStore;
}): Promise<RuntimeContext> {
  const initialModel = process.env.OPENAI_MODEL_REASONING ?? process.env.OPENAI_MODEL ?? "gpt-5";
  const taskObject = await parseTaskObject({
    provider: args.provider,
    model: initialModel,
    prompt: args.prompt,
  });
  const routedModel = routeModel({
    prompt: args.prompt,
    taskObject,
    env: process.env,
  });
  const budget = buildRuntimeBudget({
    taskObject,
    routedModel,
  });
  const fallbackModels = buildFallbackModels({
    primaryModel: routedModel.model,
    provider: routedModel.provider,
    profile: routedModel.profile,
    env: process.env,
  });
  const allHistory = await args.sessionStore.getAll();
  const contextPlan = buildContextPlan({
    profile: routedModel.profile,
    shouldUseHistory: taskObject.shouldUseHistory,
    requiresMemory: taskObject.requiresMemory,
    requiresKnowledge: taskObject.requiresKnowledge,
    historyCount: allHistory.length,
  });
  const maxChars = profileMaxChars(routedModel.profile);
  const recentHistory = contextPlan.includeHistory
    ? compactHistory(allHistory.slice(-contextPlan.historyLimit), maxChars)
    : [];
  const olderHistory = contextPlan.includeHistory
    ? allHistory.slice(0, Math.max(0, allHistory.length - contextPlan.historyLimit))
    : [];
  contextPlan.historySummary = summarizeHistory(olderHistory, Math.max(60, Math.floor(maxChars / 2)));
  const memoryQuery = taskObject.keywords.length ? taskObject.keywords.join(" ") : args.prompt;
  const memoryHits = contextPlan.includeMemory
    ? compactMemory(await args.memoryStore.search(memoryQuery, contextPlan.memoryLimit), maxChars)
    : [];
  const knowledgeQuery = taskObject.keywords.length ? taskObject.keywords.join(" ") : args.prompt;
  const knowledgeHits = contextPlan.includeKnowledge
    ? compactKnowledge(
        await args.knowledgeStore.search(knowledgeQuery, contextPlan.knowledgeLimit),
        maxChars * 2,
      )
    : [];

  return {
    systemPrompt: buildSystemPrompt({
      taskObject,
      contextPlan,
    }),
    taskObject,
    contextPlan,
    memoryHits,
    knowledgeHits,
    recentHistory,
    routedModel,
    fallbackModels,
    budget,
    mode: args.mode,
  };
}
