import type { RuntimeBudget, RoutedModel, TaskObject } from "../types/index.js";

function envPrefixForProvider(provider: RoutedModel["provider"]): string {
  switch (provider) {
    case "openai":
      return "OPENAI";
    case "anthropic":
      return "ANTHROPIC";
    case "google":
      return "GOOGLE";
    case "deepseek":
      return "DEEPSEEK";
    case "azure-openai":
      return "AZURE_OPENAI";
    default: {
      const exhaustiveCheck: never = provider;
      return exhaustiveCheck;
    }
  }
}

export function buildRuntimeBudget(args: {
  taskObject: TaskObject;
  routedModel: RoutedModel;
}): RuntimeBudget {
  const riskMultiplier = args.taskObject.riskLevel === "high" ? 1.2 : args.taskObject.riskLevel === "medium" ? 1 : 0.8;

  const base =
    args.routedModel.profile === "fast"
      ? {
          maxTurns: 4,
          maxToolCalls: 3,
          maxTotalTokens: 6000,
          maxOutputTokens: 700,
          maxRetries: 1,
          maxRunDurationMs: 30_000,
          maxToolExecutionMs: 4_000,
          maxRepeatedToolCalls: 1,
          maxConsecutiveEmptyTurns: 1,
        }
      : args.routedModel.profile === "long_context"
        ? {
            maxTurns: 8,
            maxToolCalls: 6,
            maxTotalTokens: 18000,
            maxOutputTokens: 1600,
            maxRetries: 2,
            maxRunDurationMs: 60_000,
            maxToolExecutionMs: 8_000,
            maxRepeatedToolCalls: 2,
            maxConsecutiveEmptyTurns: 2,
          }
        : {
            maxTurns: 6,
            maxToolCalls: 4,
            maxTotalTokens: 10000,
            maxOutputTokens: 1200,
            maxRetries: 2,
            maxRunDurationMs: 45_000,
            maxToolExecutionMs: 6_000,
            maxRepeatedToolCalls: 2,
            maxConsecutiveEmptyTurns: 2,
          };

  return {
    maxTurns: Math.max(2, Math.round(base.maxTurns * riskMultiplier)),
    maxToolCalls: Math.max(2, Math.round(base.maxToolCalls * riskMultiplier)),
    maxTotalTokens: Math.max(2500, Math.round(base.maxTotalTokens * riskMultiplier)),
    maxOutputTokens: Math.max(400, Math.round(base.maxOutputTokens * riskMultiplier)),
    maxRetries: base.maxRetries,
    maxRunDurationMs: base.maxRunDurationMs,
    maxToolExecutionMs: base.maxToolExecutionMs,
    maxRepeatedToolCalls: base.maxRepeatedToolCalls,
    maxConsecutiveEmptyTurns: base.maxConsecutiveEmptyTurns,
  };
}

export function buildFallbackModels(args: {
  primaryModel: string;
  provider: RoutedModel["provider"];
  profile: RoutedModel["profile"];
  env: NodeJS.ProcessEnv;
}): string[] {
  const prefix = envPrefixForProvider(args.provider);
  const candidates = [
    args.profile === "long_context"
      ? args.env[`${prefix}_MODEL_LONG_FALLBACK`]
      : args.profile === "fast"
        ? args.env[`${prefix}_MODEL_FAST_FALLBACK`]
        : args.env[`${prefix}_MODEL_REASONING_FALLBACK`],
    args.env[`${prefix}_MODEL_FALLBACK`],
    args.env[`${prefix}_MODEL`] ?? undefined,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(candidates.filter((model) => model !== args.primaryModel)));
}
