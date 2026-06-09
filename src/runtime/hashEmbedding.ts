const DEFAULT_EMBEDDING_DIMENSIONS = 192;

export function normalizeSemanticText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function tokenizeSemanticText(text: string): string[] {
  return normalizeSemanticText(text)
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function stableHash(input: string): number {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function addWeightedFeature(
  vector: number[],
  feature: string,
  weight: number,
): void {
  const bucket = stableHash(feature) % vector.length;
  const sign = stableHash(`${feature}:sign`) % 2 === 0 ? 1 : -1;
  vector[bucket] += weight * sign;
}

export function createHashedEmbedding(
  text: string,
  dimensions = DEFAULT_EMBEDDING_DIMENSIONS,
): number[] {
  const tokens = tokenizeSemanticText(text);
  const counts = new Map<string, number>();

  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const bigram = `${tokens[index]}__${tokens[index + 1]}`;
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  const vector = new Array<number>(Math.max(32, dimensions)).fill(0);

  for (const [feature, count] of counts) {
    const baseWeight = feature.includes("__") ? 0.85 : 1;
    addWeightedFeature(vector, feature, baseWeight * (1 + Math.log(count)));
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }

  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function lexicalOverlapScore(leftText: string, rightText: string): number {
  const leftTokens = new Set(tokenizeSemanticText(leftText));
  const rightTokens = new Set(tokenizeSemanticText(rightText));

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}
