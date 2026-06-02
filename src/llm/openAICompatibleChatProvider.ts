import OpenAI, { AzureOpenAI } from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions/completions";

import type {
  ModelProvider,
  ProviderFunctionCall,
  ProviderInput,
  ProviderInputItem,
  ProviderMessageItem,
  ProviderRequest,
  ProviderResponse,
  ProviderToolDefinition,
  ProviderUsage,
  StructuredRequest,
} from "./provider.js";
import { buildJsonModeInstructions, parseStructuredFromText } from "./provider.js";

type ChatClient = OpenAI | AzureOpenAI;

function textPart(text: string): ChatCompletionContentPartText {
  return {
    type: "text",
    text,
  };
}

function imagePart(imageUrl: string): ChatCompletionContentPartImage {
  return {
    type: "image_url",
    image_url: {
      url: imageUrl,
    },
  };
}

function toChatMessages(input: ProviderInput): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  for (const item of input) {
    switch (item.type) {
      case "message":
        messages.push(asChatMessage(item));
        break;
      case "assistant_tool_calls":
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: item.calls.map<ChatCompletionMessageToolCall>((call) => ({
            id: call.callId,
            type: "function",
            function: {
              name: call.name,
              arguments: call.arguments,
            },
          })),
        });
        break;
      case "function_call_output": {
        const previousToolCall = findToolCallName(messages, item.call_id);
        messages.push({
          role: "tool",
          tool_call_id: item.call_id,
          content: item.output,
          ...(previousToolCall ? { name: previousToolCall } : {}),
        } satisfies ChatCompletionToolMessageParam);
        break;
      }
      default: {
        const exhaustiveCheck: never = item;
        throw new Error(`Unsupported input item: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return messages;
}

function asChatMessage(item: ProviderMessageItem): ChatCompletionMessageParam {
  const contentParts: Array<ChatCompletionContentPartText | ChatCompletionContentPartImage> = [];

  for (const part of item.content) {
    switch (part.type) {
      case "input_text":
        contentParts.push(textPart(part.text));
        break;
      case "input_image":
        contentParts.push(imagePart(part.image_url));
        break;
      case "input_file":
        break;
      default: {
        const exhaustiveCheck: never = part;
        throw new Error(`Unsupported content part: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  if (item.role === "assistant") {
    const assistantText = contentParts
      .filter((part): part is ChatCompletionContentPartText => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    return {
      role: "assistant",
      content: assistantText || null,
    } satisfies ChatCompletionAssistantMessageParam;
  }

  const firstText = contentParts.length === 1 && contentParts[0]?.type === "text" ? contentParts[0].text : null;

  return {
    role: item.role,
    content: firstText ?? contentParts,
  };
}

function findToolCallName(
  messages: ChatCompletionMessageParam[],
  toolCallId: string,
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant" || !("tool_calls" in message) || !message.tool_calls) {
      continue;
    }

    const toolCall = message.tool_calls.find((item) => item.id === toolCallId);
    if (toolCall) {
      return toolCall.function.name;
    }
  }

  return undefined;
}

function asChatTools(tools: ProviderToolDefinition[] | undefined): ChatCompletionTool[] | undefined {
  return tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: true,
    },
  }));
}

function asUsage(usage: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
} | null | undefined): ProviderUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.prompt_tokens ?? 0,
    output_tokens: usage.completion_tokens ?? 0,
    total_tokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
  };
}

export class OpenAICompatibleChatProvider implements ModelProvider {
  readonly supportsStructuredOutputs = true;
  readonly supportsStreaming = false;
  readonly supportsTools = true;
  readonly supportsVision = true;

  constructor(
    readonly name: "google" | "deepseek" | "azure-openai",
    private readonly client: ChatClient,
  ) {}

  async createResponse(args: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.client.chat.completions.create({
      model: args.model,
      messages: [
        {
          role: "system",
          content: args.instructions,
        },
        ...toChatMessages(args.input),
      ],
      tools: asChatTools(args.tools),
      tool_choice: args.tools?.length ? "auto" : undefined,
      max_completion_tokens: args.maxOutputTokens,
    });

    const choice = response.choices[0];
    if (!choice?.message) {
      throw new Error("Provider returned no completion choices.");
    }

    const functionCalls = (choice.message.tool_calls ?? []).map<ProviderFunctionCall>((call) => ({
      callId: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    }));

    return {
      id:
        response.id ??
        `${this.name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      outputText: extractMessageText(choice.message.content),
      functionCalls,
      usage: asUsage(response.usage),
    };
  }

  async parseStructured<ParsedT>(args: StructuredRequest<ParsedT>): Promise<ParsedT> {
    const response = await this.createResponse({
      model: args.model,
      instructions: buildJsonModeInstructions({
        instructions: args.instructions,
        schemaName: args.schemaName,
      }),
      input: args.input,
      maxOutputTokens: 900,
    });

    return parseStructuredFromText({
      schema: args.schema,
      text: response.outputText,
    });
  }
}

function extractMessageText(content: string | Array<{ type?: string; text?: string }> | null): string {
  if (typeof content === "string") {
    return content;
  }

  if (!content) {
    return "";
  }

  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
}
