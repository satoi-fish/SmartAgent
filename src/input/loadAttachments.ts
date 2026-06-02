import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { LoadedAttachment } from "../types/index.js";
import { extractStructuredAttachment } from "./attachmentExtractor.js";

function mimeForExtension(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return null;
  }
}

function textAttachment(path: string, text: string, summary?: string, kind: LoadedAttachment["kind"] = "text"): LoadedAttachment {
  const normalized = text.replace(/\s+/g, " ").trim();
  const trimmed = normalized.length > 3200 ? `${normalized.slice(0, 3197)}...` : normalized;
  return {
    path,
    kind,
    summary: summary ?? `Loaded ${kind} attachment ${path}`,
    content: {
      type: "input_text",
      text: `Attachment from ${path}:\n${trimmed}`,
    },
  };
}

async function imageAttachment(path: string, mimeType: string): Promise<LoadedAttachment> {
  const bytes = await readFile(path);
  const dataUrl = `data:${mimeType};base64,${bytes.toString("base64")}`;

  return {
    path,
    kind: "image",
    summary: `Loaded image attachment ${path}`,
    content: {
      type: "input_image",
      image_url: dataUrl,
      detail: "auto",
    },
  };
}

function isPlainTextExtension(ext: string): boolean {
  return [".md", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".yml", ".yaml"].includes(ext);
}

function isStructuredDocumentExtension(ext: string): boolean {
  return [".pdf", ".csv", ".tsv", ".xlsx", ".xlsm"].includes(ext);
}

export async function loadAttachments(paths: string[]): Promise<LoadedAttachment[]> {
  const attachments: LoadedAttachment[] = [];

  for (const inputPath of paths) {
    const absolutePath = resolve(inputPath);
    const ext = extname(absolutePath).toLowerCase();

    if (isPlainTextExtension(ext)) {
      const text = await readFile(absolutePath, "utf8");
      attachments.push(textAttachment(absolutePath, text));
      continue;
    }

    if (isStructuredDocumentExtension(ext)) {
      try {
        const extracted = await extractStructuredAttachment(absolutePath);
        attachments.push(textAttachment(absolutePath, extracted.text, extracted.summary, extracted.kind));
      } catch (error) {
        attachments.push({
          path: absolutePath,
          kind: "unsupported",
          summary:
            `Attachment extraction unavailable for ${absolutePath}: ` +
            (error instanceof Error ? error.message : String(error)),
          content: {
            type: "input_text",
            text:
              `Attachment from ${absolutePath} could not be extracted automatically. ` +
              `Reason: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
      continue;
    }

    const mimeType = mimeForExtension(ext);
    if (mimeType) {
      attachments.push(await imageAttachment(absolutePath, mimeType));
      continue;
    }

    attachments.push({
      path: absolutePath,
      kind: "unsupported",
      summary: `Unsupported attachment type for ${absolutePath}`,
      content: null,
    });
  }

  return attachments;
}
