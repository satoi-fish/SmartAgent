import type { ConversationTurn, ContextPlan, KnowledgeChunk, MemoryRecord, ModelProfile } from "../types/index.js";

function limitsForProfile(profile: ModelProfile): {
  history: number;
  memory: number;
  knowledge: number;
  maxChars: number;
} {
  switch (profile) {
    case "fast":
      return { history: 2, memory: 2, knowledge: 2, maxChars: 120 };
    case "long_context":
      return { history: 6, memory: 5, knowledge: 5, maxChars: 260 };
    case "reasoning":
    default:
      return { history: 4, memory: 3, knowledge: 4, maxChars: 180 };
  }
}

function trimText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 3)}...`;
}

export function summarizeHistory(turns: ConversationTurn[], maxChars: number): string | null {
  if (turns.length === 0) {
    return null;
  }

  return turns.map((turn) => `${turn.role}: ${trimText(turn.text, maxChars)}`).join(" | ");
}

export function compactHistory(turns: ConversationTurn[], maxChars: number): ConversationTurn[] {
  return turns.map((turn) => ({
    ...turn,
    text: trimText(turn.text, maxChars),
  }));
}

export function compactMemory(records: MemoryRecord[], maxChars: number): MemoryRecord[] {
  return records.map((record) => ({
    ...record,
    text: trimText(record.text, maxChars),
  }));
}

export function compactKnowledge(chunks: KnowledgeChunk[], maxChars: number): KnowledgeChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    content: trimText(chunk.content, maxChars),
  }));
}

export function buildContextPlan(args: {
  profile: ModelProfile;
  shouldUseHistory: boolean;
  requiresMemory: boolean;
  requiresKnowledge: boolean;
  historyCount: number;
}): ContextPlan {
  const profileLimits = limitsForProfile(args.profile);
  const includeHistory = args.shouldUseHistory && args.historyCount > 0;
  const includeMemory = args.requiresMemory;
  const includeKnowledge = args.requiresKnowledge;

  return {
    includeHistory,
    includeMemory,
    includeKnowledge,
    historyLimit: includeHistory ? profileLimits.history : 0,
    memoryLimit: includeMemory ? profileLimits.memory : 0,
    knowledgeLimit: includeKnowledge ? profileLimits.knowledge : 0,
    historySummary: null,
    strategyNotes: [
      includeHistory
        ? `Use at most ${includeHistory ? profileLimits.history : 0} recent turns and summarize any older ones.`
        : "Ignore prior history unless the user explicitly requests continuity.",
      includeMemory
        ? `Use at most ${profileLimits.memory} durable memory records tied to stable project facts.`
        : "Skip long-term memory unless the task suggests persistent preferences or facts matter.",
      includeKnowledge
        ? `Use at most ${profileLimits.knowledge} retrieved knowledge chunks and trim them aggressively.`
        : "Skip knowledge retrieval unless task grounding is needed.",
      `Trim context to fit the ${args.profile} model profile before escalating to a longer-context model.`,
    ],
  };
}

export function profileMaxChars(profile: ModelProfile): number {
  return limitsForProfile(profile).maxChars;
}
