import type { ProviderName } from "../types/index.js";
import type { ZodType } from "zod";

export interface ProviderTextContent {
  type: "input_text";
  text: string;
}

export interface ProviderImageContent {
  type: "input_image";
  image_url: string;
  detail: "low" | "high" | "auto";
}

export interface ProviderFileContent {
  type: "input_file";
  file_data?: string;
  file_id?: string | null;
  filename?: string;
}

export type ProviderInputContent =
  | ProviderTextContent
  | ProviderImageContent
  | ProviderFileContent;

export interface ProviderMessageItem {
  type: "message";
  role: "user" | "assistant";
  content: ProviderInputContent[];
}

export interface ProviderFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface ProviderAssistantToolCallsItem {
  type: "assistant_tool_calls";
  calls: ProviderFunctionCall[];
}

export interface ProviderFunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ProviderInputItem =
  | ProviderMessageItem
  | ProviderAssistantToolCallsItem
  | ProviderFunctionCallOutputItem;

export type ProviderInput = ProviderInputItem[];

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ProviderUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface ProviderRequest {
  model: string;
  instructions: string;
  input: ProviderInput;
  tools?: ProviderToolDefinition[];
  maxOutputTokens?: number;
}

export interface ProviderResponse {
  id: string;
  outputText: string;
  functionCalls: ProviderFunctionCall[];
  usage?: ProviderUsage;
  streamedText?: boolean;
}

export interface ProviderStreamCallbacks {
  onTextDelta?: (delta: string) => void;
}

export interface StructuredRequest<ParsedT> {
  model: string;
  instructions: string;
  input: ProviderInput;
  schema: ZodType<ParsedT>;
  schemaName: string;
}

export interface ProviderFactoryArgs {
  providerName: ProviderName;
  env: NodeJS.ProcessEnv;
  apiKey?: string;
}

export interface ModelProvider {
  name: ProviderName;
  supportsStructuredOutputs: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  createResponse(args: ProviderRequest): Promise<ProviderResponse>;
  streamResponse?(
    args: ProviderRequest,
    callbacks: ProviderStreamCallbacks,
  ): Promise<ProviderResponse>;
  parseStructured<ParsedT>(args: StructuredRequest<ParsedT>): Promise<ParsedT>;
}

export function buildJsonModeInstructions(args: {
  instructions: string;
  schemaName: string;
}): string {
  return [
    args.instructions,
    `Return a single valid JSON object for schema "${args.schemaName}".`,
    "Do not wrap the JSON in markdown fences.",
    "Do not add commentary before or after the JSON.",
  ].join("\n");
}

export function extractJsonObject(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] ?? text;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in model output.");
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

export function parseStructuredFromText<ParsedT>(args: {
  schema: ZodType<ParsedT>;
  text: string;
}): ParsedT {
  const jsonText = extractJsonObject(args.text);
  const parsed = JSON.parse(jsonText) as unknown;
  return args.schema.parse(parsed);
}

export function sumUsage(parts: Array<Partial<ProviderUsage> | undefined>): ProviderUsage | undefined {
  const usage = parts.reduce<ProviderUsage | null>((acc, item) => {
    if (!item) {
      return acc;
    }

    const next = acc ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    next.input_tokens += item.input_tokens ?? 0;
    next.output_tokens += item.output_tokens ?? 0;
    next.total_tokens += item.total_tokens ?? 0;
    return next;
  }, null);

  return usage ?? undefined;
}
