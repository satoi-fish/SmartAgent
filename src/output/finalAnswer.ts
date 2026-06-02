import { z } from "zod";

import type { ModelProvider, ProviderInput } from "../llm/provider.js";
import { parseStructuredWithRetry } from "../llm/parseStructuredWithRetry.js";
import type { KnowledgeChunk, StructuredFinalAnswer } from "../types/index.js";

const finalAnswerSchema = z.object({
  summary: z.string(),
  answer: z.string(),
  risks: z.array(z.string()),
  next_steps: z.array(z.string()),
  citations: z.array(z.string()),
  needs_human_review: z.boolean(),
});

function buildStructuredInput(args: {
  prompt: string;
  rawAnswer: string;
  knowledgeHits: KnowledgeChunk[];
}): ProviderInput {
  const sourceText = args.knowledgeHits.length
    ? args.knowledgeHits
        .map(
          (hit) =>
            `- ${hit.id} | ${hit.sourcePath}\n  ${hit.content.slice(0, 280).replace(/\s+/g, " ")}`,
        )
        .join("\n")
    : "No retrieved knowledge sources.";

  return [
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            `Original user request:\n${args.prompt}`,
            `Draft answer:\n${args.rawAnswer}`,
            `Available sources:\n${sourceText}`,
            "Convert the draft answer into the required JSON structure. Do not invent citations. If the answer implies risky changes or missing data, mark needs_human_review as true.",
          ].join("\n\n"),
        },
      ],
    },
  ] satisfies ProviderInput;
}

function fallbackStructuredAnswer(args: {
  rawAnswer: string;
  knowledgeHits: KnowledgeChunk[];
}): StructuredFinalAnswer {
  const normalized = args.rawAnswer.trim();
  const looksLikeRefusal = /(^|\b)(can't|cannot|unable|refuse|sorry)(\b|$)/i.test(normalized);
  return {
    summary: normalized.split(/\n+/)[0]?.slice(0, 140) || "No summary available.",
    answer: args.rawAnswer,
    risks: [],
    next_steps: [],
    citations: args.knowledgeHits.map((hit) => `${hit.id} (${hit.sourcePath})`),
    needs_human_review: looksLikeRefusal || !normalized,
  };
}

export function renderStructuredAnswer(answer: StructuredFinalAnswer): string {
  const sections = [
    `Summary: ${answer.summary}`,
    `Answer:\n${answer.answer}`,
    `Risks:\n${answer.risks.length ? answer.risks.map((risk) => `- ${risk}`).join("\n") : "- None"}`,
    `Next steps:\n${
      answer.next_steps.length ? answer.next_steps.map((step) => `- ${step}`).join("\n") : "- None"
    }`,
    `Sources:\n${
      answer.citations.length ? answer.citations.map((citation) => `- ${citation}`).join("\n") : "- None"
    }`,
    `Needs human review: ${answer.needs_human_review ? "yes" : "no"}`,
  ];

  return sections.join("\n\n");
}

export async function structureFinalAnswer(args: {
  provider: ModelProvider;
  model: string;
  prompt: string;
  rawAnswer: string;
  knowledgeHits: KnowledgeChunk[];
}): Promise<StructuredFinalAnswer> {
  if (!args.provider.supportsStructuredOutputs) {
    return fallbackStructuredAnswer({
      rawAnswer: args.rawAnswer,
      knowledgeHits: args.knowledgeHits,
    });
  }

  try {
    return await parseStructuredWithRetry({
      provider: args.provider,
      request: {
        model: args.model,
        instructions:
          "You convert an agent draft into a stable final answer object. Preserve meaning, stay concise, and only cite the provided sources.",
        input: buildStructuredInput({
          prompt: args.prompt,
          rawAnswer: args.rawAnswer,
          knowledgeHits: args.knowledgeHits,
        }),
        schema: finalAnswerSchema,
        schemaName: "final_answer",
      },
    });
  } catch {
    return fallbackStructuredAnswer({
      rawAnswer: args.rawAnswer,
      knowledgeHits: args.knowledgeHits,
    });
  }
}
