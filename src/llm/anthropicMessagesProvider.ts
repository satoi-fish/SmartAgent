import type {
  ModelProvider,
  ProviderFunctionCall,
  ProviderInput,
  ProviderInputContent,
  ProviderRequest,
  ProviderResponse,
  ProviderToolDefinition,
  ProviderUsage,
  StructuredRequest,
} from "./provider.js";
import { buildJsonModeInstructions, parseStructuredFromText } from "./provider.js";

interface AnthropicContentBlockText {
  type: "text";
  text: string;
}

interface AnthropicContentBlockImage {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

interface AnthropicContentBlockToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicContentBlockToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

type AnthropicMessageBlock =
  | AnthropicContentBlockText
  | AnthropicContentBlockImage
  | AnthropicContentBlockToolUse
  | AnthropicContentBlockToolResult;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicMessageBlock[];
}

interface AnthropicResponse {
  id: string;
  content: AnthropicMessageBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicMessagesProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly supportsStructuredOutputs = true;
  readonly supportsStreaming = false;
  readonly supportsTools = true;
  readonly supportsVision = true;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.anthropic.com/v1/messages",
  ) {}

  async createResponse(args: ProviderRequest): Promise<ProviderResponse> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxOutputTokens ?? 1200,
        system: args.instructions,
        messages: toAnthropicMessages(args.input),
        tools: args.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed with ${response.status}: ${await response.text()}`);
    }

    const payload = (await response.json()) as AnthropicResponse;
    const functionCalls = payload.content
      .filter((block): block is AnthropicContentBlockToolUse => block.type === "tool_use")
      .map<ProviderFunctionCall>((block) => ({
        callId: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
      }));

    return {
      id: payload.id,
      outputText: payload.content
        .filter((block): block is AnthropicContentBlockText => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim(),
      functionCalls,
      usage: payload.usage
        ? {
            input_tokens: payload.usage.input_tokens ?? 0,
            output_tokens: payload.usage.output_tokens ?? 0,
            total_tokens: (payload.usage.input_tokens ?? 0) + (payload.usage.output_tokens ?? 0),
          }
        : undefined,
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

function toAnthropicMessages(input: ProviderInput): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];

  for (const item of input) {
    switch (item.type) {
      case "message":
        messages.push({
          role: item.role,
          content: item.content.flatMap((part) => toAnthropicContent(part)),
        });
        break;
      case "assistant_tool_calls":
        messages.push({
          role: "assistant",
          content: item.calls.map((call) => ({
            type: "tool_use",
            id: call.callId,
            name: call.name,
            input: safeParseObject(call.arguments),
          })),
        });
        break;
      case "function_call_output":
        messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: item.call_id,
              content: item.output,
            },
          ],
        });
        break;
      default: {
        const exhaustiveCheck: never = item;
        throw new Error(`Unsupported input item: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return messages;
}

function toAnthropicContent(part: ProviderInputContent): AnthropicMessageBlock[] {
  switch (part.type) {
    case "input_text":
      return [{ type: "text", text: part.text }];
    case "input_image": {
      const imageSource = dataUrlToAnthropicSource(part.image_url);
      return imageSource
        ? [{ type: "image", source: imageSource }]
        : [{ type: "text", text: "[Image input omitted because it was not a data URL.]" }];
    }
    case "input_file":
      return part.filename
        ? [{ type: "text", text: `[File input: ${part.filename}]` }]
        : [{ type: "text", text: "[File input omitted.]" }];
    default: {
      const exhaustiveCheck: never = part;
      throw new Error(`Unsupported content part: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

function dataUrlToAnthropicSource(imageUrl: string):
  | { type: "base64"; media_type: string; data: string }
  | null {
  const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const [, mediaType, data] = match;
  return {
    type: "base64",
    media_type: mediaType,
    data,
  };
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
