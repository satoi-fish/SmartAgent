import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  FunctionTool,
  ParsedResponseFunctionToolCall,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses";

import type {
  ModelProvider,
  ProviderAssistantToolCallsItem,
  ProviderFunctionCallOutputItem,
  ProviderInput,
  ProviderInputItem,
  ProviderMessageItem,
  ProviderRequest,
  ProviderResponse,
  ProviderToolDefinition,
  ProviderUsage,
  ProviderStreamCallbacks,
  StructuredRequest,
} from "./provider.js";

function asOpenAIInput(input: ProviderInput): ResponseInput {
  return input.flatMap((item) => mapInputItem(item));
}

function mapInputItem(item: ProviderInputItem): ResponseInputItem[] {
  switch (item.type) {
    case "message":
      return [mapMessage(item)];
    case "assistant_tool_calls":
      return item.calls.map((call) => ({
        type: "function_call",
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      }));
    case "function_call_output":
      return [mapFunctionCallOutput(item)];
    default: {
      const exhaustiveCheck: never = item;
      throw new Error(`Unsupported input item: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function mapMessage(item: ProviderMessageItem): ResponseInputItem {
  return {
    role: item.role,
    content: item.content,
  };
}

function mapFunctionCallOutput(item: ProviderFunctionCallOutputItem): ResponseInputItem {
  return {
    type: "function_call_output",
    call_id: item.call_id,
    output: item.output,
  };
}

function asOpenAITools(tools: ProviderToolDefinition[] | undefined): FunctionTool[] | undefined {
  return tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: true,
  }));
}

function asUsage(usage: ResponseUsage | undefined): ProviderUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
  };
}

export class OpenAIResponsesProvider implements ModelProvider {
  readonly name = "openai";
  readonly supportsStructuredOutputs = true;
  readonly supportsStreaming = true;
  readonly supportsTools = true;
  readonly supportsVision = true;

  constructor(private readonly client: OpenAI) {}

  async createResponse(args: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.client.responses.create({
      model: args.model,
      instructions: args.instructions,
      input: asOpenAIInput(args.input),
      tools: asOpenAITools(args.tools),
      max_output_tokens: args.maxOutputTokens,
      parallel_tool_calls: false,
    });

    const functionCalls = response.output
      .filter((item): item is ResponseFunctionToolCall => item.type === "function_call")
      .map((call) => ({
        callId: call.call_id,
        name: call.name,
        arguments: call.arguments,
      }));

    return {
      id: response.id,
      outputText: response.output_text,
      functionCalls,
      usage: asUsage(response.usage),
      streamedText: false,
    };
  }

  async streamResponse(
    args: ProviderRequest,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse> {
    const stream = this.client.responses.stream({
      model: args.model,
      instructions: args.instructions,
      input: asOpenAIInput(args.input),
      tools: asOpenAITools(args.tools),
      max_output_tokens: args.maxOutputTokens,
      parallel_tool_calls: false,
    });

    for await (const event of stream) {
      handleStreamEvent(event, callbacks);
    }

    const response = await stream.finalResponse();
    const functionCalls = response.output
      .filter((item): item is ParsedResponseFunctionToolCall => item.type === "function_call")
      .map((call) => ({
        callId: call.call_id,
        name: call.name,
        arguments: call.arguments,
      }));

    return {
      id: response.id,
      outputText: response.output_text,
      functionCalls,
      usage: asUsage(response.usage),
      streamedText: true,
    };
  }

  async parseStructured<ParsedT>(args: StructuredRequest<ParsedT>): Promise<ParsedT> {
    const response = await this.client.responses.parse({
      model: args.model,
      instructions: args.instructions,
      input: asOpenAIInput(args.input),
      text: {
        format: zodTextFormat(args.schema, args.schemaName),
      },
    });

    if (!response.output_parsed) {
      throw new Error("Structured output parsing returned null.");
    }

    return response.output_parsed;
  }
}

function handleStreamEvent(event: ResponseStreamEvent, callbacks: ProviderStreamCallbacks): void {
  if (event.type === "response.output_text.delta" && event.delta) {
    callbacks.onTextDelta?.(event.delta);
  }
}
