import type {
  ModelCapability,
  ModelProfile,
  ProviderName,
  RoutedModel,
  TaskObject,
} from "../types/index.js";

function parseProviderName(raw: string | undefined): ProviderName {
  switch (raw) {
    case "anthropic":
    case "google":
    case "deepseek":
    case "azure-openai":
      return raw;
    case "openai":
    case undefined:
    case "":
      return "openai";
    default:
      return "openai";
  }
}

function envPrefixForProvider(provider: ProviderName): string {
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

function defaultModelForProvider(provider: ProviderName, profile: ModelProfile): string {
  switch (provider) {
    case "openai":
      return profile === "fast" ? "gpt-5-mini" : "gpt-5";
    case "anthropic":
      return profile === "fast" ? "claude-3-5-haiku-latest" : "claude-sonnet-4-0";
    case "google":
      return profile === "fast" ? "gemini-2.5-flash" : "gemini-2.5-pro";
    case "deepseek":
      return profile === "reasoning" ? "deepseek-reasoner" : "deepseek-chat";
    case "azure-openai":
      return profile === "fast" ? "gpt-4.1-mini" : "gpt-4.1";
    default: {
      const exhaustiveCheck: never = provider;
      return exhaustiveCheck;
    }
  }
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value && value.trim() ? value.trim() : undefined;
}

export function buildModelCatalogFromEnv(env: NodeJS.ProcessEnv): ModelCapability[] {
  const provider = parseProviderName(env.MODEL_PROVIDER);
  const prefix = envPrefixForProvider(provider);
  const defaultModel = envValue(env, `${prefix}_MODEL`) ?? defaultModelForProvider(provider, "reasoning");
  const fastModel = envValue(env, `${prefix}_MODEL_FAST`) ?? defaultModelForProvider(provider, "fast");
  const reasoningModel =
    envValue(env, `${prefix}_MODEL_REASONING`) ?? defaultModelForProvider(provider, "reasoning");
  const longModel = envValue(env, `${prefix}_MODEL_LONG`) ?? defaultModelForProvider(provider, "reasoning");
  const supportsTools = true;
  const supportsStructuredOutputs = true;
  const supportsVision = provider !== "deepseek";

  return [
    {
      provider,
      model: fastModel || defaultModel,
      profile: "fast",
      maxContext: "standard",
      supportsTools,
      supportsStructuredOutputs,
      supportsVision,
      costTier: "low",
    },
    {
      provider,
      model: reasoningModel || defaultModel,
      profile: "reasoning",
      maxContext: "standard",
      supportsTools,
      supportsStructuredOutputs,
      supportsVision,
      costTier: "medium",
    },
    {
      provider,
      model: longModel || defaultModel,
      profile: "long_context",
      maxContext: "long",
      supportsTools,
      supportsStructuredOutputs,
      supportsVision,
      costTier: "high",
    },
  ];
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function inferTaskProfile(prompt: string): {
  profile: ModelProfile;
  reason: string;
} {
  const normalized = prompt.toLowerCase();

  if (
    prompt.length > 1200 ||
    includesAny(normalized, ["repo", "long context", "many files", "大量", "长上下文", "整个项目"])
  ) {
    return {
      profile: "long_context",
      reason: "Prompt suggests a broad or long-context task.",
    };
  }

  if (
    includesAny(normalized, [
      "analyze",
      "debug",
      "design",
      "plan",
      "architecture",
      "排查",
      "设计",
      "架构",
      "分析",
      "规划",
    ])
  ) {
    return {
      profile: "reasoning",
      reason: "Prompt looks like a planning or analysis task.",
    };
  }

  if (
    includesAny(normalized, [
      "summarize",
      "extract",
      "classify",
      "rewrite",
      "总结",
      "提取",
      "分类",
      "改写",
      "列一下",
    ])
  ) {
    return {
      profile: "fast",
      reason: "Prompt looks like a lightweight summarization or extraction task.",
    };
  }

  return {
    profile: "reasoning",
    reason: "Defaulting to the reasoning profile for balanced quality.",
  };
}

export function routeModel(args: {
  prompt: string;
  taskObject?: TaskObject;
  env: NodeJS.ProcessEnv;
}): RoutedModel {
  const catalog = buildModelCatalogFromEnv(args.env);
  const inferred = inferTaskProfile(args.prompt);
  const profile =
    args.taskObject?.riskLevel === "high"
      ? "reasoning"
      : args.taskObject?.responseStyle === "detailed"
        ? "reasoning"
        : inferred.profile;
  const reason =
    args.taskObject?.riskLevel === "high"
      ? "Using the reasoning profile because the parsed task is high risk."
      : args.taskObject?.responseStyle === "detailed"
        ? "Using the reasoning profile because the task requests a detailed response."
        : inferred.reason;
  const selected =
    catalog.find((capability) => capability.profile === profile) ??
    catalog.find((capability) => capability.profile === "reasoning") ??
    catalog[0];

  return {
    provider: selected.provider,
    model: selected.model,
    profile: selected.profile,
    reason,
    capability: selected,
  };
}
