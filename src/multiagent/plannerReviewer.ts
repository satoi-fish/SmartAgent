import { z } from "zod";

import type { ModelProvider } from "../llm/provider.js";
import { parseStructuredWithRetry } from "../llm/parseStructuredWithRetry.js";
import { renderStructuredAnswer, structureFinalAnswer } from "../output/finalAnswer.js";
import type { FileLogger } from "../telemetry/fileLogger.js";
import type { PlannerBrief, ReviewReport, StructuredFinalAnswer } from "../types/index.js";

const plannerBriefSchema = z.object({
  summary: z.string(),
  focusAreas: z.array(z.string()),
  toolHints: z.array(z.string()),
  reviewChecks: z.array(z.string()),
});

const reviewReportSchema = z.object({
  approved: z.boolean(),
  concerns: z.array(z.string()),
  recommendedChanges: z.array(z.string()),
});

function formatPlannerBrief(brief: PlannerBrief): string {
  return [
    `Planner summary: ${brief.summary}`,
    `Focus areas: ${brief.focusAreas.join(", ") || "none"}`,
    `Tool hints: ${brief.toolHints.join(", ") || "none"}`,
    `Review checks: ${brief.reviewChecks.join(", ") || "none"}`,
  ].join("\n");
}

export async function createPlannerBrief(args: {
  provider: ModelProvider;
  model: string;
  prompt: string;
  taskIntent: string;
}): Promise<PlannerBrief> {
  return await parseStructuredWithRetry({
    provider: args.provider,
    request: {
      model: args.model,
      instructions:
        "You are the planner agent. Create a short execution brief for another agent. Be concrete about focus areas, likely tools, and what a reviewer should verify.",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `User request: ${args.prompt}\nTask intent: ${args.taskIntent}`,
            },
          ],
        },
      ],
      schema: plannerBriefSchema,
      schemaName: "planner_brief",
    },
  });
}

export async function reviewFinalAnswer(args: {
  provider: ModelProvider;
  model: string;
  prompt: string;
  plannerBrief: PlannerBrief;
  structuredAnswer: StructuredFinalAnswer;
}): Promise<ReviewReport> {
  return await parseStructuredWithRetry({
    provider: args.provider,
    request: {
      model: args.model,
      instructions:
        "You are the reviewer agent. Evaluate whether the final answer is safe, grounded, and aligned with the planner brief. Approve only if the answer is good enough without extra edits.",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Original request:\n${args.prompt}`,
                `Planner brief:\n${formatPlannerBrief(args.plannerBrief)}`,
                `Final answer summary:\n${args.structuredAnswer.summary}`,
                `Final answer body:\n${args.structuredAnswer.answer}`,
                `Risks:\n${args.structuredAnswer.risks.join("\n") || "none"}`,
                `Citations:\n${args.structuredAnswer.citations.join("\n") || "none"}`,
              ].join("\n\n"),
            },
          ],
        },
      ],
      schema: reviewReportSchema,
      schemaName: "review_report",
    },
  });
}

export async function reviseAnswerWithReviewer(args: {
  provider: ModelProvider;
  model: string;
  prompt: string;
  plannerBrief: PlannerBrief;
  reviewReport: ReviewReport;
  currentAnswer: string;
  citations: string[];
}): Promise<StructuredFinalAnswer> {
  const revisedDraftResponse = await args.provider.createResponse({
    model: args.model,
    instructions:
      "Revise the draft answer using planner and reviewer feedback. Keep the answer concise, practical, and grounded.",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Original request:\n${args.prompt}`,
              `Planner brief:\n${formatPlannerBrief(args.plannerBrief)}`,
              `Current answer:\n${args.currentAnswer}`,
              `Reviewer concerns:\n${args.reviewReport.concerns.join("\n") || "none"}`,
              `Requested changes:\n${args.reviewReport.recommendedChanges.join("\n") || "none"}`,
            ].join("\n\n"),
          },
        ],
      },
    ],
    maxOutputTokens: 900,
  });

  return structureFinalAnswer({
    provider: args.provider,
    model: args.model,
    prompt: args.prompt,
    rawAnswer: revisedDraftResponse.outputText,
    knowledgeHits: args.citations.map((citation, index) => ({
      id: `review-citation-${index + 1}`,
      title: citation,
      content: citation,
      sourcePath: citation,
      score: 1,
    })),
  });
}

export function emitPlannerReviewerEvents(args: {
  logger: FileLogger;
  brief: PlannerBrief;
  review?: ReviewReport;
}): void {
  args.logger.emit({
    type: "planner_brief",
    summary: args.brief.summary,
    focus: args.brief.focusAreas,
  });

  if (args.review) {
    args.logger.emit({
      type: "review_report",
      approved: args.review.approved,
      concerns: args.review.concerns,
    });
  }
}

export function mergeReviewerNotes(args: {
  structuredAnswer: StructuredFinalAnswer;
  reviewReport: ReviewReport;
}): string {
  const rendered = renderStructuredAnswer(args.structuredAnswer);
  if (args.reviewReport.approved) {
    return rendered;
  }

  const reviewerNotes = [
    "Reviewer notes:",
    ...args.reviewReport.concerns.map((item) => `- ${item}`),
  ].join("\n");

  return `${rendered}\n\n${reviewerNotes}`;
}
