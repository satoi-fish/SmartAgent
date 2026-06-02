import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import type { AttachmentKind } from "../types/index.js";

export interface ExtractedAttachmentPayload {
  kind: Exclude<AttachmentKind, "image" | "unsupported">;
  summary: string;
  text: string;
}

export async function extractStructuredAttachment(path: string): Promise<ExtractedAttachmentPayload> {
  const pythonBin = await resolvePythonExecutable();
  const scriptPath = resolve(process.cwd(), "scripts", "extract_attachment.py");

  const stdout = await execFileJson(pythonBin, [scriptPath, path], 20_000);
  const parsed = JSON.parse(stdout) as Partial<ExtractedAttachmentPayload>;

  if (!parsed || typeof parsed !== "object" || typeof parsed.text !== "string" || typeof parsed.summary !== "string") {
    throw new Error("Attachment extractor returned an invalid payload.");
  }

  const kind = parsed.kind;
  if (kind !== "text" && kind !== "table" && kind !== "document") {
    throw new Error(`Attachment extractor returned an unsupported kind: ${String(kind)}`);
  }

  return {
    kind,
    summary: parsed.summary,
    text: parsed.text,
  };
}

async function resolvePythonExecutable(): Promise<string> {
  const candidates = [
    process.env.AGENT_PYTHON_BIN,
    resolve(
      homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "python",
      "bin",
      "python3",
    ),
    "python3",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (candidate === "python3") {
      return candidate;
    }

    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return "python3";
}

async function execFileJson(command: string, args: string[], timeoutMs: number): Promise<string> {
  return await new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(`Attachment extraction timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `Attachment extraction failed with exit code ${code ?? -1}.`));
        return;
      }

      resolvePromise(stdout.trim());
    });
  });
}
