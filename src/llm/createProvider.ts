import OpenAI, { AzureOpenAI } from "openai";

import type { ProviderName } from "../types/index.js";
import { AnthropicMessagesProvider } from "./anthropicMessagesProvider.js";
import { OpenAICompatibleChatProvider } from "./openAICompatibleChatProvider.js";
import { OpenAIResponsesProvider } from "./openaiResponsesProvider.js";
import type { ModelProvider, ProviderFactoryArgs } from "./provider.js";

export function resolveProviderApiKey(args: {
  providerName: ProviderName;
  env: NodeJS.ProcessEnv;
  apiKey?: string;
}): string {
  if (args.apiKey) {
    return args.apiKey;
  }

  const fromEnv =
    args.providerName === "openai"
      ? args.env.OPENAI_API_KEY
      : args.providerName === "anthropic"
        ? args.env.ANTHROPIC_API_KEY
        : args.providerName === "google"
          ? args.env.GOOGLE_API_KEY ?? args.env.GEMINI_API_KEY
          : args.providerName === "deepseek"
            ? args.env.DEEPSEEK_API_KEY
            : args.env.AZURE_OPENAI_API_KEY;

  if (!fromEnv) {
    throw new Error(`Missing API key for provider "${args.providerName}".`);
  }

  return fromEnv;
}

export function createProvider(args: ProviderFactoryArgs): ModelProvider {
  const apiKey = resolveProviderApiKey(args);

  switch (args.providerName) {
    case "openai":
      return new OpenAIResponsesProvider(new OpenAI({ apiKey }));
    case "anthropic":
      return new AnthropicMessagesProvider(
        apiKey,
        args.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1/messages",
      );
    case "google":
      return new OpenAICompatibleChatProvider(
        "google",
        new OpenAI({
          apiKey,
          baseURL:
            args.env.GOOGLE_BASE_URL ??
            "https://generativelanguage.googleapis.com/v1beta/openai/",
        }),
      ) as unknown as ModelProvider;
    case "deepseek":
      return new OpenAICompatibleChatProvider(
        "deepseek",
        new OpenAI({
          apiKey,
          baseURL: args.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1",
        }),
      );
    case "azure-openai": {
      const endpoint = args.env.AZURE_OPENAI_ENDPOINT;
      const apiVersion = args.env.OPENAI_API_VERSION ?? args.env.AZURE_OPENAI_API_VERSION;
      if (!endpoint || !apiVersion) {
        throw new Error(
          "Azure OpenAI requires AZURE_OPENAI_ENDPOINT and OPENAI_API_VERSION (or AZURE_OPENAI_API_VERSION).",
        );
      }

      return new OpenAICompatibleChatProvider(
        "azure-openai",
        new AzureOpenAI({
          apiKey,
          endpoint,
          apiVersion,
        }),
      );
    }
    default: {
      const exhaustiveCheck: never = args.providerName;
      throw new Error(`Unsupported provider: ${exhaustiveCheck}`);
    }
  }
}
