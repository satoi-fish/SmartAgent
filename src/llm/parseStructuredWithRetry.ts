import type { ModelProvider, StructuredRequest } from "./provider.js";

export async function parseStructuredWithRetry<ParsedT>(args: {
  provider: ModelProvider;
  request: StructuredRequest<ParsedT>;
  retries?: number;
}): Promise<ParsedT> {
  const retries = args.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await args.provider.parseStructured({
        ...args.request,
        instructions:
          attempt === 0
            ? args.request.instructions
            : [
                args.request.instructions,
                "Previous attempt did not cleanly match the schema.",
                "Return exactly one complete object that matches the schema.",
                "Do not omit required fields and do not include markdown fences.",
              ].join("\n"),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw (lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Structured parsing failed.")));
}
