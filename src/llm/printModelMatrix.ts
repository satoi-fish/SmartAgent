import "dotenv/config";

import { buildModelCatalogFromEnv } from "./router.js";
import { buildFallbackModels } from "../runtime/budget.js";

const catalog = buildModelCatalogFromEnv(process.env);

const lines = catalog.map((item) => {
  const fallbackModels = buildFallbackModels({
    primaryModel: item.model,
    provider: item.provider,
    profile: item.profile,
    env: process.env,
  });

  return [
    `Profile: ${item.profile}`,
    `  Provider: ${item.provider}`,
    `  Model: ${item.model}`,
    `  Context: ${item.maxContext}`,
    `  Cost tier: ${item.costTier}`,
    `  Tools: ${item.supportsTools ? "yes" : "no"}`,
    `  Structured outputs: ${item.supportsStructuredOutputs ? "yes" : "no"}`,
    `  Vision: ${item.supportsVision ? "yes" : "no"}`,
    `  Fallbacks: ${fallbackModels.length ? fallbackModels.join(", ") : "none"}`,
  ].join("\n");
});

process.stdout.write(`${lines.join("\n\n")}\n`);
