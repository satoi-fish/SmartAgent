import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type PermissionDecision = "allow" | "ask" | "deny" | "passthrough";

interface PolicyFileShape {
  permissions?: {
    allow?: string[];
    ask?: string[];
    deny?: string[];
  };
}

function matches(pattern: string, toolName: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(toolName);
}

export class PermissionPolicy {
  constructor(
    private readonly rules: {
      allow: string[];
      ask: string[];
      deny: string[];
    },
  ) {}

  evaluate(toolName: string): PermissionDecision {
    if (this.rules.deny.some((pattern) => matches(pattern, toolName))) {
      return "deny";
    }

    if (this.rules.allow.some((pattern) => matches(pattern, toolName))) {
      return "allow";
    }

    if (this.rules.ask.some((pattern) => matches(pattern, toolName))) {
      return "ask";
    }

    return "passthrough";
  }
}

export async function loadPermissionPolicy(
  filePath = resolve(process.cwd(), ".agent-permissions.json"),
): Promise<PermissionPolicy> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as PolicyFileShape;

    return new PermissionPolicy({
      allow: parsed.permissions?.allow ?? [],
      ask: parsed.permissions?.ask ?? [],
      deny: parsed.permissions?.deny ?? [],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new PermissionPolicy({
        allow: [],
        ask: [],
        deny: [],
      });
    }

    throw error;
  }
}
