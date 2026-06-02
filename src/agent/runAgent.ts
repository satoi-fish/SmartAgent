import type {
  ModelProvider,
  ProviderFunctionCallOutputItem,
  ProviderInput,
  ProviderInputContent,
  ProviderInputItem,
  ProviderToolDefinition,
} from "../llm/provider.js";
import { renderStructuredAnswer, structureFinalAnswer } from "../output/finalAnswer.js";
import type { FileLogger } from "../telemetry/fileLogger.js";
import type { PermissionPolicy } from "../tools/policy.js";
import type { AgentRunResult, AnyToolDefinition, ConversationTurn, RuntimeContext } from "../types/index.js";

function asProviderTools(tools: AnyToolDefinition[]): ProviderToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.jsonSchema,
  }));
}

function findTool(name: string, tools: AnyToolDefinition[]): AnyToolDefinition | undefined {
  return tools.find((tool) => tool.name === name);
}

function historyToInput(history: ConversationTurn[]): ProviderInputItem[] {
  return history.map((turn) => ({
    type: "message",
    role: turn.role,
    content: [{ type: "input_text", text: turn.text }],
  }));
}

function emitTextDeltas(args: {
  logger: FileLogger;
  text: string;
  enabled: boolean;
}): void {
  if (!args.enabled) {
    return;
  }

  const chunkSize = 120;
  for (let index = 0; index < args.text.length; index += chunkSize) {
    args.logger.emit({
      type: "output_text_delta",
      delta: args.text.slice(index, index + chunkSize),
    });
  }
}

function buildTerminalResult(args: {
  rawAnswer: string;
  renderedAnswer?: string;
  risks?: string[];
  citations?: string[];
  needsHumanReview?: boolean;
  toolCalls: string[];
  usage: AgentRunResult["usage"];
}): AgentRunResult {
  const renderedAnswer = args.renderedAnswer ?? args.rawAnswer;

  return {
    rawAnswer: args.rawAnswer,
    renderedAnswer,
    structuredAnswer: {
      summary: args.rawAnswer,
      answer: renderedAnswer,
      risks: args.risks ?? [],
      next_steps: [],
      citations: args.citations ?? [],
      needs_human_review: args.needsHumanReview ?? true,
    },
    toolCalls: args.toolCalls,
    usage: args.usage,
  };
}

async function withTimeout<T>(args: {
  label: string;
  timeoutMs: number;
  task: Promise<T>;
}): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${args.label} timed out after ${args.timeoutMs}ms.`));
    }, args.timeoutMs);

    args.task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runAgent(args: {
  provider: ModelProvider;
  prompt: string;
  userContents?: ProviderInputContent[];
  runtimeContext: RuntimeContext;
  tools: AnyToolDefinition[];
  permissionPolicy: PermissionPolicy;
  logger: FileLogger;
  streamOutput?: boolean;
}): Promise<AgentRunResult> {
  const { provider, prompt, runtimeContext, tools, permissionPolicy, logger } = args;
  let turn = 0;
  let toolCalls = 0;
  const toolCallNames: string[] = [];
  const repeatedToolSignatures = new Map<string, number>();
  const startedAt = Date.now();
  let consecutiveEmptyTurns = 0;
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  const instructions = [
    runtimeContext.systemPrompt,
    runtimeContext.memoryHits.length
      ? `Relevant memory:\n- ${runtimeContext.memoryHits.map((hit) => hit.text).join("\n- ")}`
      : "Relevant memory: none",
    runtimeContext.contextPlan.historySummary
      ? `Earlier history summary:\n${runtimeContext.contextPlan.historySummary}`
      : "Earlier history summary: none",
    runtimeContext.knowledgeHits.length
      ? `Relevant knowledge:\n- ${runtimeContext.knowledgeHits
          .map((hit) => `${hit.id} (${hit.sourcePath}): ${hit.content.slice(0, 240)}`)
          .join("\n- ")}`
      : "Relevant knowledge: none",
    `Selected provider: ${runtimeContext.routedModel.provider}`,
    `Selected model: ${runtimeContext.routedModel.model}`,
    `Model route: ${runtimeContext.routedModel.reason}`,
  ].join("\n\n");
  let transcript: ProviderInput = [
    ...historyToInput(runtimeContext.recentHistory),
    {
      type: "message",
      role: "user",
      content: args.userContents ?? [{ type: "input_text", text: prompt }],
    },
  ];

  logger.emit({
    type: "run_started",
    prompt,
    mode: runtimeContext.mode,
    provider: runtimeContext.routedModel.provider,
    model: runtimeContext.routedModel.model,
    profile: runtimeContext.routedModel.profile,
    detail: runtimeContext.routedModel.reason,
  });

  logger.emit({
    type: "task_parsed",
    intent: runtimeContext.taskObject.intent,
    riskLevel: runtimeContext.taskObject.riskLevel,
    goal: runtimeContext.taskObject.goal,
    uses_history: runtimeContext.contextPlan.includeHistory,
    uses_memory: runtimeContext.contextPlan.includeMemory,
    uses_knowledge: runtimeContext.contextPlan.includeKnowledge,
  });

  logger.emit({
    type: "context_compacted",
    history_included: runtimeContext.recentHistory.length,
    history_summarized: Boolean(runtimeContext.contextPlan.historySummary),
    memory_included: runtimeContext.memoryHits.length,
    knowledge_included: runtimeContext.knowledgeHits.length,
    strategy: runtimeContext.contextPlan.strategyNotes,
  });

  logger.emit({
    type: "budget_selected",
    max_turns: runtimeContext.budget.maxTurns,
    max_tool_calls: runtimeContext.budget.maxToolCalls,
    max_total_tokens: runtimeContext.budget.maxTotalTokens,
    max_output_tokens: runtimeContext.budget.maxOutputTokens,
    max_retries: runtimeContext.budget.maxRetries,
    max_run_duration_ms: runtimeContext.budget.maxRunDurationMs,
    max_tool_execution_ms: runtimeContext.budget.maxToolExecutionMs,
    max_repeated_tool_calls: runtimeContext.budget.maxRepeatedToolCalls,
    max_consecutive_empty_turns: runtimeContext.budget.maxConsecutiveEmptyTurns,
  });

  logger.emit({
    type: "knowledge_retrieved",
    count: runtimeContext.knowledgeHits.length,
    sources: runtimeContext.knowledgeHits.map((hit) => `${hit.id} (${hit.sourcePath})`),
  });

  while (turn < runtimeContext.budget.maxTurns) {
    turn += 1;

    const remainingRunBudgetMs = runtimeContext.budget.maxRunDurationMs - (Date.now() - startedAt);
    if (remainingRunBudgetMs <= 0) {
      const answer = "Stopped because the overall run timeout was reached.";
      logger.emit({ type: "run_completed", answer });
      return buildTerminalResult({
        rawAnswer: answer,
        risks: ["The run stopped because the overall execution timeout was reached."],
        needsHumanReview: true,
        toolCalls: toolCallNames,
        usage,
      });
    }

    const useProviderStreaming =
      Boolean(args.streamOutput) && provider.supportsStreaming && typeof provider.streamResponse === "function";
    const response = await withTimeout({
      label: "Model response",
      timeoutMs: Math.max(1000, Math.min(remainingRunBudgetMs, runtimeContext.budget.maxRunDurationMs)),
      task: useProviderStreaming
        ? provider.streamResponse!(
            {
              model: runtimeContext.routedModel.model,
              instructions,
              input: transcript,
              tools: provider.supportsTools ? asProviderTools(tools) : undefined,
              maxOutputTokens: runtimeContext.budget.maxOutputTokens,
            },
            {
              onTextDelta: (delta) => {
                if (!delta) {
                  return;
                }

                logger.emit({
                  type: "output_text_delta",
                  delta,
                });
              },
            },
          )
        : provider.createResponse({
            model: runtimeContext.routedModel.model,
            instructions,
            input: transcript,
            tools: provider.supportsTools ? asProviderTools(tools) : undefined,
            maxOutputTokens: runtimeContext.budget.maxOutputTokens,
          }),
    });

    if (response.usage) {
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      usage.totalTokens += response.usage.total_tokens;

      logger.emit({
        type: "llm_usage",
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        total_tokens: response.usage.total_tokens,
      });

      if (usage.totalTokens > runtimeContext.budget.maxTotalTokens) {
        const answer = "Stopped because the total token budget was reached.";
        logger.emit({ type: "run_completed", answer });
        return buildTerminalResult({
          rawAnswer: answer,
          risks: ["The run stopped because the total token budget was reached."],
          needsHumanReview: true,
          toolCalls: toolCallNames,
          usage,
        });
      }
    }

    const functionCalls = response.functionCalls;

    if (functionCalls.length === 0) {
      const rawAnswer = response.outputText;
      if (!rawAnswer.trim()) {
        consecutiveEmptyTurns += 1;

        if (consecutiveEmptyTurns > runtimeContext.budget.maxConsecutiveEmptyTurns) {
          const answer = "Stopped because the model produced repeated empty responses.";
          logger.emit({ type: "run_completed", answer });
          return buildTerminalResult({
            rawAnswer: answer,
            risks: ["The run stopped because the model produced repeated empty responses."],
            needsHumanReview: true,
            toolCalls: toolCallNames,
            usage,
          });
        }

        transcript = [
          ...transcript,
          {
            type: "message",
            role: "assistant",
            content: [{ type: "input_text", text: "" }],
          },
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "The previous response was empty. On the next turn, either answer the user directly or call an allowed tool.",
              },
            ],
          },
        ];
        continue;
      }

      consecutiveEmptyTurns = 0;
      logger.emit({ type: "model_output", text: rawAnswer });

      const structuredAnswer = await structureFinalAnswer({
        provider,
        model: runtimeContext.routedModel.model,
        prompt,
        rawAnswer,
        knowledgeHits: runtimeContext.knowledgeHits,
      });

      const renderedAnswer = renderStructuredAnswer(structuredAnswer);
      if (!response.streamedText) {
        emitTextDeltas({
          logger,
          text: renderedAnswer,
          enabled: args.streamOutput ?? false,
        });
      }
      logger.emit({ type: "run_completed", answer: renderedAnswer });
      return {
        rawAnswer,
        renderedAnswer,
        structuredAnswer,
        toolCalls: toolCallNames,
        usage,
      };
    }

    consecutiveEmptyTurns = 0;

    const toolOutputs: ProviderFunctionCallOutputItem[] = [];

    for (const call of functionCalls) {
      if (toolCalls >= runtimeContext.budget.maxToolCalls) {
        const answer = "Stopped because the tool-call budget was reached.";
        logger.emit({ type: "run_completed", answer });
        return buildTerminalResult({
          rawAnswer: answer,
          risks: ["The run stopped because the tool-call budget was reached."],
          needsHumanReview: true,
          toolCalls: toolCallNames,
          usage,
        });
      }

      toolCalls += 1;
      toolCallNames.push(call.name);
      const toolSignature = `${call.name}:${call.arguments}`;
      const nextRepeatCount = (repeatedToolSignatures.get(toolSignature) ?? 0) + 1;
      repeatedToolSignatures.set(toolSignature, nextRepeatCount);
      if (nextRepeatCount > runtimeContext.budget.maxRepeatedToolCalls) {
        const answer = `Stopped because tool "${call.name}" was requested repeatedly with the same arguments.`;
        logger.emit({ type: "run_completed", answer });
        return buildTerminalResult({
          rawAnswer: answer,
          risks: [
            `The run stopped because tool "${call.name}" repeated the same call more than ${runtimeContext.budget.maxRepeatedToolCalls} times.`,
          ],
          needsHumanReview: true,
          toolCalls: toolCallNames,
          usage,
        });
      }
      const tool = findTool(call.name, tools);

      if (!tool) {
        logger.emit({
          type: "tool_status",
          toolName: call.name,
          status: "error",
          detail: "Tool not registered",
        });
        continue;
      }

      logger.emit({
        type: "tool_status",
        toolName: tool.name,
        status: "validating",
      });

      const permissionDecision = permissionPolicy.evaluate(tool.name);

      if (permissionDecision === "deny") {
        logger.emit({
          type: "tool_status",
          toolName: tool.name,
          status: "cancelled",
          detail: "Blocked by permission policy",
        });
        return buildTerminalResult({
          rawAnswer: `Tool "${tool.name}" is blocked by the current permission policy.`,
          risks: [`Tool "${tool.name}" matched a deny rule.`],
          needsHumanReview: true,
          toolCalls: toolCallNames,
          usage,
        });
      }

      const approvalRequired =
        permissionDecision === "ask" ||
        (permissionDecision !== "allow" && tool.requiresApproval(runtimeContext.mode));

      if (approvalRequired) {
        logger.emit({
          type: "tool_status",
          toolName: tool.name,
          status: "awaiting_approval",
          detail:
            permissionDecision === "ask"
              ? "Blocked by permission policy"
              : "Blocked by current approval mode",
        });
        return buildTerminalResult({
          rawAnswer: `The agent wants to call "${tool.name}", but the current mode requires human approval.`,
          risks: [
            permissionDecision === "ask"
              ? `Tool "${tool.name}" matched an ask rule and requires explicit approval.`
              : `Tool "${tool.name}" requires explicit approval in the current mode.`,
          ],
          needsHumanReview: true,
          toolCalls: toolCallNames,
          usage,
        });
      }

      logger.emit({
        type: "tool_status",
        toolName: tool.name,
        status: "executing",
      });

      try {
        const result = await withTimeout({
          label: `Tool "${tool.name}"`,
          timeoutMs: Math.max(500, runtimeContext.budget.maxToolExecutionMs),
          task: tool.execute(tool.validate(JSON.parse(call.arguments))),
        });
        logger.emit({
          type: "tool_status",
          toolName: tool.name,
          status: "success",
        });

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: JSON.stringify({
            summary: tool.renderForModel(result),
          }),
        });
      } catch (error) {
        logger.emit({
          type: "tool_status",
          toolName: tool.name,
          status: "error",
          detail: error instanceof Error ? error.message : String(error),
        });
        return buildTerminalResult({
          rawAnswer: `Tool execution failed for "${tool.name}".`,
          risks: [`Tool "${tool.name}" failed during execution.`],
          needsHumanReview: true,
          toolCalls: toolCallNames,
          usage,
        });
      }
    }

    transcript = [
      ...transcript,
      {
        type: "assistant_tool_calls",
        calls: functionCalls,
      },
      ...toolOutputs,
    ];
  }

  const answer = "Stopped because the turn budget was reached.";
  logger.emit({ type: "run_completed", answer });
  return buildTerminalResult({
    rawAnswer: answer,
    risks: ["The run stopped because the turn budget was reached."],
    needsHumanReview: true,
    toolCalls: toolCallNames,
    usage,
  });
}
