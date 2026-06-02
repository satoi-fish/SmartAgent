import { z } from "zod";

import type { ModelProvider } from "../llm/provider.js";
import { parseStructuredWithRetry } from "../llm/parseStructuredWithRetry.js";
import type { TaskObject } from "../types/index.js";

const taskSchema = z.object({
  goal: z.string(),
  intent: z.enum([
    "general_qa",
    "planning",
    "deployment",
    "incident",
    "memory_management",
    "write_action",
  ]),
  riskLevel: z.enum(["low", "medium", "high"]),
  requiresKnowledge: z.boolean(),
  requiresMemory: z.boolean(),
  shouldUseHistory: z.boolean(),
  responseStyle: z.enum(["concise", "detailed"]),
  preferredToolNames: z.array(z.string()),
  keywords: z.array(z.string()),
});

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function fallbackParse(prompt: string): TaskObject {
  const normalized = prompt.toLowerCase();

  let intent: TaskObject["intent"] = "general_qa";
  if (includesAny(normalized, ["deploy", "release", "发布", "部署"])) {
    intent = "deployment";
  } else if (includesAny(normalized, ["incident", "outage", "事故", "故障"])) {
    intent = "incident";
  } else if (includesAny(normalized, ["remember", "memory", "记住", "记忆"])) {
    intent = "memory_management";
  } else if (includesAny(normalized, ["draft", "create", "write", "创建", "执行"])) {
    intent = "write_action";
  } else if (includesAny(normalized, ["plan", "design", "analyze", "规划", "设计", "分析"])) {
    intent = "planning";
  }

  const riskLevel: TaskObject["riskLevel"] =
    intent === "write_action" || includesAny(normalized, ["production", "prod", "生产"])
      ? "high"
      : intent === "deployment" || intent === "incident"
        ? "medium"
        : "low";

  const keywords = Array.from(
    new Set(
      prompt
        .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 2)
        .slice(0, 8),
    ),
  );

  return {
    goal: prompt,
    intent,
    riskLevel,
    requiresKnowledge: intent !== "memory_management",
    requiresMemory: !includesAny(normalized, ["one-off", "一次性"]),
    shouldUseHistory: !includesAny(normalized, ["ignore history", "新话题"]),
    responseStyle:
      includesAny(normalized, ["detailed", "deep", "详细", "深入"]) || prompt.length > 120
        ? "detailed"
        : "concise",
    preferredToolNames:
      intent === "memory_management"
        ? ["search_long_term_memory", "remember_project_fact", "forget_project_memory"]
        : intent === "deployment" || intent === "incident"
          ? ["search_knowledge_base", "search_project_docs"]
          : [],
    keywords,
  };
}

export async function parseTaskObject(args: {
  provider: ModelProvider;
  model: string;
  prompt: string;
}): Promise<TaskObject> {
  if (!args.provider.supportsStructuredOutputs) {
    return fallbackParse(args.prompt);
  }

  try {
    return await parseStructuredWithRetry({
      provider: args.provider,
      request: {
        model: args.model,
        instructions:
          "Convert the user request into a task object for an engineering agent. Mark risky or side-effecting tasks as medium/high risk. Keep keywords concise and do not invent requirements.",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: args.prompt }],
          },
        ],
        schema: taskSchema,
        schemaName: "task_object",
      },
    });
  } catch {
    return fallbackParse(args.prompt);
  }
}
