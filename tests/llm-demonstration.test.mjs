import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {
  createDemonstration, tokenizeExample, gradientDescentExample,
  DEMONSTRATION_MAX_CODE_POINTS, DEMONSTRATION_MAX_CHUNKS, DEMONSTRATION_RMS_EPSILON,
} from "../lib/llm-demonstration.ts";

const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
function finiteTree(value) {
  if (typeof value === "number") assert.ok(Number.isFinite(value), `Non-finite value: ${value}`);
  else if (Array.isArray(value)) value.forEach(finiteTree);
  else if (value && typeof value === "object") Object.values(value).forEach(finiteTree);
}
function attentionInvariants(block, causal) {
  for (let row = 0; row < block.q.length; row += 1) {
    near(block.weights[row].reduce((sum, value) => sum + value, 0), 1);
    for (let column = 0; column < block.k.length; column += 1) {
      if (causal && column > row) {
        assert.equal(block.scores[row][column], null);
        assert.equal(block.weights[row][column], 0);
      } else {
        const dot = block.q[row].reduce((sum, value, index) => sum + value * block.k[column][index], 0);
        near(block.scores[row][column], dot / 2);
        assert.ok(block.weights[row][column] > 0);
      }
    }
    const valid = block.scores[row].filter(value => value !== null);
    const maximum = Math.max(...valid);
    const total = valid.reduce((sum, value) => sum + Math.exp(value - maximum), 0);
    block.scores[row].forEach((value, column) => near(block.weights[row][column], value === null ? 0 : Math.exp(value - maximum) / total));
  }
}

test("conceptual chunks preserve Arabic, diacritics, emoji, whitespace and UTF-16 offsets", () => {
  const text = "  سَلَامٌ على العالم 👩🏽‍💻!  ";
  const result = tokenizeExample(text);
  assert.equal(result.truncated, false);
  assert.equal(result.codePoints, [...text].length);
  assert.deepEqual(result.pieces.map(piece => piece.text), ["  سَلَامٌ", " على", " العالم", " 👩🏽‍💻", "!  "]);
  assert.equal(result.pieces.map(piece => piece.text).join(""), text);
  const decoder = new TextDecoder();
  for (const [index, piece] of result.pieces.entries()) {
    assert.equal(text.slice(piece.start, piece.end), piece.text);
    assert.equal(decoder.decode(Uint8Array.from(piece.bytes)), piece.text);
    assert.equal(piece.start, index ? result.pieces[index - 1].end : 0);
    assert.equal("id" in piece, false, "byte values must not be presented as provider token IDs");
  }
  assert.deepEqual(tokenizeExample("ع").pieces[0].bytes, [216, 185]);
});

test("character/chunk bounds are exact and repair malformed surrogates without reordering RTL", () => {
  const atLimit = tokenizeExample("أ".repeat(DEMONSTRATION_MAX_CODE_POINTS));
  assert.equal(atLimit.truncated, false);
  assert.equal(atLimit.pieces[0].text.length, DEMONSTRATION_MAX_CODE_POINTS);
  const overLimit = tokenizeExample("أ".repeat(DEMONSTRATION_MAX_CODE_POINTS + 1));
  assert.equal(overLimit.truncated, true);
  assert.equal(overLimit.codePoints, DEMONSTRATION_MAX_CODE_POINTS);
  assert.equal([...overLimit.pieces[0].text].length, DEMONSTRATION_MAX_CODE_POINTS);
  const manyChunks = tokenizeExample("و ".repeat(DEMONSTRATION_MAX_CHUNKS + 1));
  assert.equal(manyChunks.pieces.length, DEMONSTRATION_MAX_CHUNKS);
  assert.equal(manyChunks.truncated, true);
  const emoji = tokenizeExample("😀".repeat(241));
  assert.equal(emoji.codePoints, 240);
  assert.ok(emoji.pieces.every(piece => piece.text === "😀"));
  const repaired = tokenizeExample("\ud800أ\udc00\u202eعلم\u202c");
  assert.equal(repaired.pieces.map(piece => piece.text).join(""), "\ufffdأ\ufffd\u202eعلم\u202c");
  for (const piece of repaired.pieces) assert.equal(new TextDecoder().decode(Uint8Array.from(piece.bytes)), piece.text);
});

test("empty/whitespace sources have no invented state or probabilities in every architecture", () => {
  for (const input of ["", " \t\n\r "]) for (const mode of ["decoder", "encoder", "encoder-decoder"]) {
    const result = createDemonstration(input, mode);
    assert.deepEqual(result.tokens, []);
    for (const name of ["embeddings", "positions", "inputs", "q", "k", "v", "scores", "weights", "attentionOutput", "residual", "normalized", "feedForwardInput", "feedForward", "hidden", "candidates"]) assert.deepEqual(result[name], []);
    assert.equal(result.nextToken, null);
    assert.equal(result.crossAttention, null);
    finiteTree(result);
  }
  assert.throws(() => createDemonstration("text", "unknown"), RangeError);
});

test("decoder attention uses scaled dot products, stable softmax and an exact causal mask", () => {
  const result = createDemonstration("الشمس تشرق كل صباح");
  attentionInvariants(result, true);
  assert.deepEqual(result.weights[0], [1, 0, 0, 0]);
  const changedFuture = createDemonstration("الشمس تشرق كل مساء");
  assert.deepEqual(result.hidden.slice(0, 3), changedFuture.hidden.slice(0, 3), "future text cannot change earlier causal states");
  assert.notDeepEqual(result.hidden.at(-1), changedFuture.hidden.at(-1));
  finiteTree(result);
});

test("positional encoding, projections, residuals and RMSNorm follow their mathematical definitions", () => {
  const result = createDemonstration("one two three");
  assert.deepEqual(result.positions[0], [0, 1, 0, 1]);
  near(result.positions[1][0], Math.sin(1));
  near(result.positions[1][1], Math.cos(1));
  near(result.positions[1][2], Math.sin(0.01));
  near(result.positions[1][3], Math.cos(0.01));
  const x = result.inputs[0];
  near(result.q[0][0], 0.5 * x[0] + 0.1 * x[1] - 0.4 * x[2] + 0.3 * x[3]);
  // The first causal row has one edge, so its attention mixture is exactly V[0].
  const v = result.v[0];
  near(result.attentionOutput[0][0], 0.7 * v[0] + 0.1 * v[2] + 0.2 * v[3]);
  near(result.attentionOutput[0][1], 0.1 * v[0] + 0.6 * v[1] - 0.1 * v[2]);
  for (let row = 0; row < result.tokens.length; row += 1) {
    const meanSquare = result.residual[row].reduce((sum, value) => sum + value ** 2, 0) / 4;
    for (let column = 0; column < 4; column += 1) {
      near(result.inputs[row][column], result.embeddings[row][column] + result.positions[row][column]);
      near(result.residual[row][column], result.inputs[row][column] + result.attentionOutput[row][column]);
      near(result.normalized[row][column], result.residual[row][column] / Math.sqrt(meanSquare + DEMONSTRATION_RMS_EPSILON));
      near(result.hidden[row][column], result.feedForwardInput[row][column] + result.feedForward[row][column]);
    }
  }
});

test("an encoder is bidirectional and does not claim a next-token head", () => {
  const encoder = createDemonstration("one two three", "encoder");
  attentionInvariants(encoder, false);
  assert.ok(encoder.weights[0][2] > 0);
  assert.deepEqual(encoder.candidates, []);
  assert.equal(encoder.nextToken, null);
  assert.equal(encoder.encoder, null);
  assert.notDeepEqual(encoder.hidden[0], createDemonstration("one two changed", "encoder").hidden[0]);
});

test("encoder-decoder cross-attention uses a separate start query and encoded source memory", () => {
  const result = createDemonstration("المعنى من السياق", "encoder-decoder");
  assert.deepEqual(result.tokens.map(token => token.text), ["<start>"]);
  assert.deepEqual(result.encoder.tokens.map(token => token.text), ["المعنى", " من", " السياق"]);
  attentionInvariants(result.encoder, false);
  assert.deepEqual(result.weights, [[1]]);
  const cross = result.crossAttention;
  assert.equal(cross.q.length, 1);
  assert.equal(cross.k.length, 3);
  assert.equal(cross.weights[0].length, 3);
  near(cross.weights[0].reduce((sum, value) => sum + value, 0), 1);
  for (let index = 0; index < 3; index += 1) {
    near(cross.scores[0][index], cross.q[0].reduce((sum, value, column) => sum + value * cross.k[index][column], 0) / 2);
    assert.ok(cross.weights[0][index] > 0);
    const memory = result.encoder.hidden[index];
    near(cross.k[index][0], 0.4 * memory[0] - 0.1 * memory[1] + 0.2 * memory[2] + 0.3 * memory[3]);
  }
  const joined = result.normalized[0].map((value, column) => value + cross.output[0][column]);
  const scale = Math.sqrt(joined.reduce((sum, value) => sum + value ** 2, 0) / 4 + DEMONSTRATION_RMS_EPSILON);
  joined.forEach((value, column) => near(result.feedForwardInput[0][column], value / scale));
  assert.notDeepEqual(result.candidates, createDemonstration("سياق مختلف تماماً", "encoder-decoder").candidates);
  finiteTree(result);
});

test("the explicit candidate distribution is reproducible, normalized and input-dependent", () => {
  const result = createDemonstration("Hello عالم");
  assert.deepEqual(result, createDemonstration("Hello عالم"));
  assert.deepEqual(result.candidates.map(candidate => candidate.text), ["العالم", "التعلم", "الضوء", "hello", "world", "."]);
  near(result.candidates.reduce((sum, candidate) => sum + candidate.probability, 0), 1);
  const maxLogit = Math.max(...result.candidates.map(candidate => candidate.logit));
  const denominator = result.candidates.reduce((sum, candidate) => sum + Math.exp(candidate.logit - maxLogit), 0);
  for (const candidate of result.candidates) near(candidate.probability, Math.exp(candidate.logit - maxLogit) / denominator);
  assert.equal(result.nextToken, [...result.candidates].sort((a, b) => b.probability - a.probability)[0].text);
  assert.notDeepEqual(result.candidates, createDemonstration("Hello ضوء").candidates);
  result.embeddings[0][0] = 999;
  assert.notEqual(createDemonstration("Hello عالم").embeddings[0][0], 999, "callers cannot mutate subsequent demonstrations");
});

test("scalar training follows the analytic gradient and monotonically reduces the quadratic loss", () => {
  const result = gradientDescentExample();
  assert.equal(result.steps.length, 13);
  near(result.steps[0].prediction, 0.4);
  near(result.steps[0].loss, 3.38);
  near(result.steps[0].gradient, -5.2);
  near(result.steps[1].weight, 0.72);
  near(result.steps[1].loss, 1.2168);
  for (const current of result.steps) {
    near(current.loss, 3.38 * Math.pow(0.6, 2 * current.step));
    const h = 1e-5;
    const loss = weight => 0.5 * (weight * result.x - result.target) ** 2;
    near(current.gradient, (loss(current.weight + h) - loss(current.weight - h)) / (2 * h), 1e-9);
    if (current.step) {
      const previous = result.steps[current.step - 1];
      near(current.weight, previous.weight - result.learningRate * previous.gradient);
      assert.ok(current.loss <= previous.loss);
    }
  }
  for (const weight of [-1e6, -2, 0, 1.5, 4, 1e6]) for (const rate of [Number.MIN_VALUE, Number.EPSILON, 0.1, 0.25, 0.49, 0.5 - Number.EPSILON]) {
    const trajectory = gradientDescentExample(weight, rate);
    finiteTree(trajectory);
    trajectory.steps.slice(1).forEach((step, index) => assert.ok(step.loss <= trajectory.steps[index].loss));
  }
  assert.equal(gradientDescentExample(1.5).lossReduction, 0);
  assert.equal(gradientDescentExample(0, 0.25).steps[1].weight, 1.5);
  for (const weight of [NaN, Infinity, -Infinity, 1e6 + 1]) assert.throws(() => gradientDescentExample(weight), RangeError);
  for (const rate of [NaN, Infinity, -Infinity, 0, -0.1, 0.5, 1]) assert.throws(() => gradientDescentExample(0.2, rate), RangeError);
});

test("the arithmetic runs in an isolated browser-like context with no network, process or Node APIs", () => {
  const source = readFileSync(new URL("../lib/llm-demonstration.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const context = vm.createContext({ exports: {}, TextEncoder });
  vm.runInContext(outputText, context);
  for (const mode of ["decoder", "encoder", "encoder-decoder"]) {
    const result = context.exports.createDemonstration("أهلاً بالعالم 🌍", mode);
    finiteTree(result);
    assert.ok(result.tokens.length > 0);
  }
  finiteTree(context.exports.gradientDescentExample());
});
