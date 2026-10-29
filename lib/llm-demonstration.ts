/**
 * HESSARA's deterministic, browser-only transformer arithmetic demonstration.
 * These word/Unicode chunks, byte-derived embeddings, four-dimensional weights,
 * and six output candidates are invented for teaching. They are not a provider's
 * tokenizer, vocabulary, learned parameters, or meaningful language predictions.
 * One attention head and one block show the arithmetic, not a production LLM.
 */
export type DemonstrationMode = "decoder" | "encoder" | "encoder-decoder";

export const DEMONSTRATION_DIMENSION = 4;
export const DEMONSTRATION_MAX_CODE_POINTS = 240;
export const DEMONSTRATION_MAX_CHUNKS = 16;
export const DEMONSTRATION_RMS_EPSILON = 1e-6;

export interface TokenPiece {
  text: string;
  /** UTF-8 bytes of the displayed chunk; these are not model token IDs. */
  bytes: number[];
  /** UTF-16 offsets in the sanitized source, suitable for String.slice. */
  start: number;
  end: number;
}

export interface TokenizationExample {
  pieces: TokenPiece[];
  truncated: boolean;
  /** Source code points inspected within the 240-character limit, including spaces. */
  codePoints: number;
}

export interface AttentionData {
  q: number[][];
  k: number[][];
  v: number[][];
  /** Scaled dot products; null denotes a masked edge (mathematical -Infinity). */
  scores: (number | null)[][];
  weights: number[][];
  /** (softmax(scores) × V) × W_O, ready for the residual connection. */
  output: number[][];
}

export interface EncoderData {
  tokens: TokenPiece[];
  embeddings: number[][];
  positions: number[][];
  inputs: number[][];
  q: number[][];
  k: number[][];
  v: number[][];
  scores: (number | null)[][];
  weights: number[][];
  attentionOutput: number[][];
  residual: number[][];
  normalized: number[][];
  /** Equals normalized, or RMSNorm(normalized + cross-attention output). */
  feedForwardInput: number[][];
  feedForward: number[][];
  /** feedForwardInput + feedForward, the block's final residual. */
  hidden: number[][];
}

export interface DemonstrationResult extends EncoderData {
  mode: DemonstrationMode;
  dimension: 4;
  /** The displayed source prefix, with malformed surrogates replaced by U+FFFD. */
  inputText: string;
  truncated: boolean;
  codePoints: number;
  /** Fixed small illustrative output vocabulary; empty for an encoder-only block. */
  candidates: { text: string; logit: number; probability: number }[];
  nextToken: string | null;
  crossAttention: AttentionData | null;
  /** In encoder-decoder mode, source states; decoder tokens contain <start>. */
  encoder: EncoderData | null;
}

export interface GradientStep {
  step: number;
  weight: number;
  prediction: number;
  loss: number;
  gradient: number;
}

export interface GradientDescentResult {
  x: number;
  target: number;
  initialWeight: number;
  learningRate: number;
  optimalWeight: number;
  steps: GradientStep[];
  lossReduction: number;
}

// Row-vector convention: X × W. All matrices below are fixed teaching values.
const W_Q = [
  [0.5, -0.2, 0.1, 0.3], [0.1, 0.6, -0.3, 0.2],
  [-0.4, 0.2, 0.7, 0.1], [0.3, 0.1, 0.2, 0.5],
];
const W_K = [
  [0.4, 0.1, -0.2, 0.3], [-0.1, 0.5, 0.3, 0.2],
  [0.2, -0.3, 0.6, 0.1], [0.3, 0.2, -0.1, 0.4],
];
const W_V = [
  [0.6, 0.1, 0.2, -0.1], [0.2, 0.5, -0.1, 0.3],
  [-0.1, 0.2, 0.7, 0.1], [0.3, -0.2, 0.1, 0.5],
];
const W_O = [
  [0.7, 0.1, 0, -0.1], [0, 0.6, 0.2, 0.1],
  [0.1, -0.1, 0.8, 0], [0.2, 0, 0.1, 0.6],
];
const W_UP = [
  [0.4, -0.3, 0.2, 0.1, 0.5, -0.2],
  [0.2, 0.5, -0.4, 0.3, -0.1, 0.2],
  [-0.1, 0.2, 0.6, -0.2, 0.3, 0.4],
  [0.3, 0.1, -0.2, 0.5, 0.2, -0.3],
];
const W_DOWN = [
  [0.3, 0.1, -0.1, 0.2], [-0.2, 0.4, 0.1, 0.1],
  [0.1, -0.2, 0.4, 0.2], [0.2, 0.1, -0.1, 0.3],
  [-0.1, 0.3, 0.2, -0.2], [0.2, -0.1, 0.1, 0.4],
];
const OUTPUT_VOCABULARY = ["العالم", "التعلم", "الضوء", "hello", "world", "."];
const W_VOCABULARY = [
  [0.4, -0.2, 0.3, 0.1, -0.3, 0.2],
  [0.1, 0.5, -0.1, 0.2, 0.3, -0.2],
  [-0.2, 0.2, 0.5, -0.3, 0.1, 0.3],
  [0.3, 0.1, -0.2, 0.4, 0.2, -0.1],
];
const VOCABULARY_BIAS = [0.02, -0.01, 0, 0.01, -0.02, 0];

function boundedSource(text: string): { text: string; truncated: boolean; codePoints: number } {
  let result = "";
  let count = 0;
  let truncated = false;
  for (const character of text) {
    if (count === DEMONSTRATION_MAX_CODE_POINTS) {
      truncated = true;
      break;
    }
    const point = character.codePointAt(0)!;
    // TextEncoder also repairs these, but repairing before chunking keeps text and bytes consistent.
    result += point >= 0xd800 && point <= 0xdfff ? "\ufffd" : character;
    count += 1;
  }
  return { text: result, truncated, codePoints: count };
}

/**
 * Conceptual Unicode/word segmentation, not BPE/SentencePiece. Spaces attach to
 * the following chunk; trailing spaces attach to the last chunk. Common emoji
 * joiner sequences stay together. The bounds protect both computation and UI.
 */
export function tokenizeExample(text: string): TokenizationExample {
  const source = boundedSource(text);
  const pieces: TokenPiece[] = [];
  const encoder = new TextEncoder();
  const chunks = /\s*(?:[\p{L}\p{M}\p{N}_]+|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})*)*|[^\s])/gu;
  let chunkTruncated = false;
  let match: RegExpExecArray | null;
  while ((match = chunks.exec(source.text)) !== null) {
    if (pieces.length === DEMONSTRATION_MAX_CHUNKS) {
      chunkTruncated = true;
      break;
    }
    pieces.push({
      text: match[0], bytes: Array.from(encoder.encode(match[0])),
      start: match.index, end: match.index + match[0].length,
    });
  }
  const last = pieces[pieces.length - 1];
  if (last && !chunkTruncated) {
    const trailing = source.text.slice(last.end);
    last.text += trailing;
    last.end = source.text.length;
    last.bytes = Array.from(encoder.encode(last.text));
  }
  return { pieces, truncated: source.truncated || chunkTruncated, codePoints: source.codePoints };
}

function project(row: number[], matrix: number[][]): number[] {
  return matrix[0].map((_, column) => row.reduce((sum, value, index) => sum + value * matrix[index][column], 0));
}

function add(left: number[][], right: number[][]): number[][] {
  return left.map((row, index) => row.map((value, column) => value + right[index][column]));
}

function rmsNorm(rows: number[][]): number[][] {
  return rows.map((row) => {
    const scale = Math.sqrt(row.reduce((sum, value) => sum + value * value, 0) / DEMONSTRATION_DIMENSION + DEMONSTRATION_RMS_EPSILON);
    // Unit gain, no bias: RMSNorm does not subtract the mean.
    return row.map((value) => value / scale);
  });
}

function softmax(scores: (number | null)[]): number[] {
  const unmasked = scores.filter((value): value is number => value !== null);
  if (!unmasked.length) return scores.map(() => 0);
  const maximum = Math.max(...unmasked);
  const exponentials = scores.map((value) => value === null ? 0 : Math.exp(value - maximum));
  const denominator = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / denominator);
}

function attention(queries: number[][], memory: number[][], causal: boolean): AttentionData {
  const q = queries.map((row) => project(row, W_Q));
  const k = memory.map((row) => project(row, W_K));
  const v = memory.map((row) => project(row, W_V));
  const scores = q.map((query, queryIndex) => k.map((key, keyIndex) => {
    if (causal && keyIndex > queryIndex) return null;
    return query.reduce((sum, value, column) => sum + value * key[column], 0) / Math.sqrt(DEMONSTRATION_DIMENSION);
  }));
  const weights = scores.map(softmax);
  const output = weights.map((row) => {
    const mixed = Array.from({ length: DEMONSTRATION_DIMENSION }, (_, column) => row.reduce((sum, weight, index) => sum + weight * v[index][column], 0));
    return project(mixed, W_O);
  });
  return { q, k, v, scores, weights, output };
}

function embedding(bytes: number[]): number[] {
  // Four bounded FNV-1a byte features, deliberately with no learned semantics.
  return Array.from({ length: DEMONSTRATION_DIMENSION }, (_, column) => {
    let hash = (2166136261 ^ Math.imul(column + 1, 2654435761)) >>> 0;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
    return (hash % 2001) / 1000 - 1;
  });
}

function buildBlock(tokens: TokenPiece[], causal: boolean, memory?: number[][]): { block: EncoderData; crossAttention: AttentionData | null } {
  const embeddings = tokens.map((token) => embedding(token.bytes));
  const positions = tokens.map((_, position) => Array.from({ length: DEMONSTRATION_DIMENSION }, (_, column) => {
    const angle = position / Math.pow(10000, (2 * Math.floor(column / 2)) / DEMONSTRATION_DIMENSION);
    return column % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
  }));
  const inputs = add(embeddings, positions);
  const selfAttention = attention(inputs, inputs, causal);
  const residual = add(inputs, selfAttention.output);
  const normalized = rmsNorm(residual);
  const crossAttention = memory && memory.length && tokens.length ? attention(normalized, memory, false) : null;
  const feedForwardInput = crossAttention ? rmsNorm(add(normalized, crossAttention.output)) : normalized;
  const feedForward = feedForwardInput.map((row) => project(project(row, W_UP).map((value) => Math.max(0, value)), W_DOWN));
  const hidden = add(feedForwardInput, feedForward);
  return {
    block: {
      tokens, embeddings, positions, inputs,
      q: selfAttention.q, k: selfAttention.k, v: selfAttention.v,
      scores: selfAttention.scores, weights: selfAttention.weights,
      attentionOutput: selfAttention.output, residual, normalized,
      feedForwardInput, feedForward, hidden,
    },
    crossAttention,
  };
}

/**
 * Encoder: bidirectional source states, no next-token language-model head.
 * Decoder: causal attention and an illustrative next-chunk vocabulary head.
 * Encoder-decoder: bidirectional source encoder; one fixed <start> decoder query
 * attends causally to itself and then cross-attends to every encoded source row.
 * The <start> offsets refer to that separate decoder string, not the source.
 */
export function createDemonstration(text: string, mode: DemonstrationMode = "decoder"): DemonstrationResult {
  if (mode !== "decoder" && mode !== "encoder" && mode !== "encoder-decoder") throw new RangeError("Unknown demonstration architecture.");
  const tokenization = tokenizeExample(text);
  let encoder: EncoderData | null = null;
  let tokens = tokenization.pieces;
  if (mode === "encoder-decoder") {
    encoder = buildBlock(tokens, false).block;
    // One explicit decoder control symbol, not three punctuation chunks.
    tokens = tokens.length ? [{ text: "<start>", bytes: Array.from(new TextEncoder().encode("<start>")), start: 0, end: 7 }] : [];
  }
  const { block, crossAttention } = buildBlock(tokens, mode !== "encoder", encoder?.hidden);
  const last = block.hidden[block.hidden.length - 1];
  const logits = mode !== "encoder" && last ? project(last, W_VOCABULARY).map((value, index) => value + VOCABULARY_BIAS[index]) : [];
  const probabilities = softmax(logits);
  const candidates = logits.map((logit, index) => ({ text: OUTPUT_VOCABULARY[index], logit, probability: probabilities[index] }));
  const next = candidates.reduce<DemonstrationResult["candidates"][number] | null>((best, candidate) => !best || candidate.probability > best.probability ? candidate : best, null);
  return {
    ...block, mode, dimension: DEMONSTRATION_DIMENSION,
    inputText: tokenization.pieces.map((piece) => piece.text).join(""),
    truncated: tokenization.truncated, codePoints: tokenization.codePoints,
    candidates, nextToken: next?.text ?? null, crossAttention, encoder,
  };
}

/**
 * y_hat = w*x; L = 0.5*(y_hat-y)^2; dL/dw = (w*x-y)*x.
 * Here x=2, so the loss curvature is 4 and 0 < rate < 2/4 guarantees
 * convergence. Invalid parameters throw; the original weight is never hidden.
 * The trajectory contains the initial state followed by twelve descent steps.
 */
export function gradientDescentExample(initialWeight = 0.2, learningRate = 0.1): GradientDescentResult {
  if (!Number.isFinite(initialWeight) || Math.abs(initialWeight) > 1e6) throw new RangeError("Initial weight must be finite and within ±1,000,000.");
  if (!Number.isFinite(learningRate) || learningRate <= 0 || learningRate >= 0.5) throw new RangeError("Learning rate must be finite and strictly between 0 and 0.5.");
  const x = 2;
  const target = 3;
  const steps: GradientStep[] = [];
  let weight = initialWeight;
  for (let step = 0; step <= 12; step += 1) {
    const prediction = weight * x;
    const error = prediction - target;
    const gradient = error * x;
    steps.push({ step, weight, prediction, loss: 0.5 * error * error, gradient });
    weight -= learningRate * gradient;
  }
  return { x, target, initialWeight, learningRate, optimalWeight: target / x, steps, lossReduction: steps[0].loss - steps[steps.length - 1].loss };
}
