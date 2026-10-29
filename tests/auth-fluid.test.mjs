import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fluidPolicy } from "../lib/auth-fluid-policy.ts";

// This checks scheduling and WebGL API ownership. It does not compile GLSL,
// execute a GPU simulation, measure performance, or verify rendered appearance.
const rendererPath = resolve(import.meta.dirname, "../lib/auth-fluid-renderer.ts");
const scripts = new Map();
function loadRenderer(globals) {
  const context = vm.createContext(globals);
  const modules = new Map();
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    let script = scripts.get(path);
    if (!script) {
      const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      });
      script = new vm.Script(`(function(require,module,exports){${outputText}\n})`, { filename: path });
      scripts.set(path, script);
    }
    const loadedModule = { exports: {} };
    modules.set(path, loadedModule);
    script.runInContext(context)(specifier => load(resolve(dirname(path), `${specifier}.ts`)), loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return load(rendererPath).createAuthFluidRenderer;
}

class TrackedTarget extends EventTarget {
  handlers = new Map();
  addEventListener(name, callback, options) {
    super.addEventListener(name, callback, options);
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(callback);
  }
  removeEventListener(name, callback, options) {
    super.removeEventListener(name, callback, options);
    this.handlers.get(name)?.delete(callback);
  }
  get count() { return [...this.handlers.values()].reduce((sum, entries) => sum + entries.size, 0); }
}

function browser({ reduced = false, hidden = false, forcedColors = false, missingExtension = false, badFramebuffer = false, badShader = false } = {}) {
  const preference = new TrackedTarget(); preference.matches = reduced;
  const colors = new TrackedTarget(); colors.matches = forcedColors;
  const page = new TrackedTarget(); page.hidden = hidden;
  const view = new TrackedTarget(); view.innerWidth = 1280; view.devicePixelRatio = 2;
  const interaction = new TrackedTarget();
  const host = { dataset: {}, parentElement: interaction, getBoundingClientRect: () => ({ width: 600, height: 720, left: 0, top: 0 }) };
  const canvas = new TrackedTarget(); canvas.width = 0; canvas.height = 0;
  const frames = new Map(); let frameId = 0;
  const observations = [], resizes = [];
  const resources = Object.fromEntries(["texture", "framebuffer", "program", "shader", "buffer", "vao"].map(name => [name, new Set()]));
  const counters = { draws: 0, displays: 0, extensions: 0, lost: 0, feedback: 0, dt: [] };
  const gl = {};
  for (const [index, name] of ["VERTEX_SHADER", "FRAGMENT_SHADER", "COMPILE_STATUS", "LINK_STATUS", "ACTIVE_UNIFORMS", "TEXTURE_2D", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER", "NEAREST", "TEXTURE_WRAP_S", "TEXTURE_WRAP_T", "CLAMP_TO_EDGE", "RGBA16F", "RGBA", "HALF_FLOAT", "FRAMEBUFFER", "COLOR_ATTACHMENT0", "FRAMEBUFFER_COMPLETE", "COLOR_BUFFER_BIT", "TEXTURE0", "TRIANGLES", "ARRAY_BUFFER", "STATIC_DRAW", "FLOAT", "BLEND", "DEPTH_TEST"].entries()) gl[name] = index + 1;
  let enabled = false, contextLost = false, selectedTexture, selectedFramebuffer, selectedProgram, textureSlot = 0;
  const bindings = new Map();
  const allocate = type => { const resource = { type }; resources[type].add(resource); return resource; };
  const remove = (type, resource) => resources[type].delete(resource);
  gl.getExtension = name => {
    if (name === "EXT_color_buffer_float") {
      counters.extensions++;
      enabled = !missingExtension && !contextLost;
      return enabled ? {} : null;
    }
    if (name === "WEBGL_lose_context") return { loseContext: () => { counters.lost++; contextLost = true; enabled = false; } };
    return null;
  };
  gl.isContextLost = () => contextLost;
  gl.createShader = type => Object.assign(allocate("shader"), { shaderType: type });
  gl.shaderSource = (shader, source) => { shader.source = source; };
  gl.compileShader = () => {};
  gl.getShaderParameter = () => !badShader;
  gl.attachShader = (program, shader) => { program.shaders.push(shader); };
  gl.createProgram = () => Object.assign(allocate("program"), { shaders: [], uniforms: new Map(), values: new Map() });
  gl.bindAttribLocation = () => {};
  gl.linkProgram = program => {
    for (const shader of program.shaders) for (const declaration of shader.source.matchAll(/uniform\s+(sampler2D|vec2|vec4|float)\s+([^;]+);/g)) {
      for (const name of declaration[2].split(",").map(value => value.trim())) program.uniforms.set(name, declaration[1]);
    }
  };
  gl.getProgramParameter = (program, parameter) => parameter === gl.ACTIVE_UNIFORMS ? program.uniforms.size : true;
  gl.getActiveUniform = (program, index) => ({ name: [...program.uniforms.keys()][index] });
  gl.getUniformLocation = (program, name) => ({ program, name });
  for (const [suffix, type] of [["Texture", "texture"], ["Framebuffer", "framebuffer"], ["Buffer", "buffer"], ["VertexArray", "vao"]]) gl[`create${suffix}`] = () => allocate(type);
  for (const [suffix, type] of [["Texture", "texture"], ["Framebuffer", "framebuffer"], ["Buffer", "buffer"], ["VertexArray", "vao"], ["Program", "program"], ["Shader", "shader"]]) gl[`delete${suffix}`] = value => remove(type, value);
  gl.bindTexture = (_type, texture) => { selectedTexture = texture; bindings.set(textureSlot, texture); };
  gl.activeTexture = slot => { textureSlot = slot - gl.TEXTURE0; };
  gl.bindFramebuffer = (_type, framebuffer) => { selectedFramebuffer = framebuffer; };
  gl.framebufferTexture2D = (_a, _b, _c, texture) => { selectedFramebuffer.texture = texture; };
  gl.checkFramebufferStatus = () => enabled && !badFramebuffer ? gl.FRAMEBUFFER_COMPLETE : 0;
  gl.texImage2D = (_type, _level, _internal, width, height) => { assert.ok(Number.isFinite(width) && width >= 1); assert.ok(Number.isFinite(height) && height >= 1); selectedTexture.width = width; selectedTexture.height = height; };
  gl.useProgram = program => { selectedProgram = program; };
  gl.uniform1i = (location, value) => { location?.program.values.set(location.name, value); };
  gl.uniform1f = (location, value) => { if (location?.name === "dt") counters.dt.push(value); location?.program.values.set(location.name, value); };
  gl.uniform2f = gl.uniform4f = () => {};
  for (const name of ["texParameteri", "viewport", "clearColor", "clear", "bindVertexArray", "bindBuffer", "bufferData", "enableVertexAttribArray", "vertexAttribPointer", "disable"]) gl[name] = () => {};
  gl.drawArrays = () => {
    counters.draws++;
    if (!selectedFramebuffer) counters.displays++;
    for (const [name, type] of selectedProgram.uniforms) if (type === "sampler2D") {
      const sampled = bindings.get(selectedProgram.values.get(name) ?? 0);
      if (selectedFramebuffer?.texture === sampled) { counters.feedback++; throw new Error("Read/write texture feedback"); }
    }
  };
  canvas.getContext = () => gl;
  class Observer {
    constructor(callback) { this.callback = callback; this.active = true; observations.push(this); }
    observe() {}
    disconnect() { this.active = false; }
  }
  class Resize {
    constructor(callback) { this.callback = callback; this.active = true; resizes.push(this); }
    observe() {}
    disconnect() { this.active = false; }
  }
  const create = loadRenderer({ document: page, window: view, navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
    matchMedia: query => query.includes("forced-colors") ? colors : preference,
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id), ResizeObserver: Resize, IntersectionObserver: Observer,
  });
  return { canvas, host, page, view, interaction, preference, colors, resources, counters, frames, observations, resizes,
    start: () => create(canvas, host),
    frame(now) { const entry = frames.entries().next().value; if (!entry) return; frames.delete(entry[0]); entry[1](now); },
    changeMotion(matches) { preference.matches = matches; preference.dispatchEvent(new Event("change")); },
    changeColors(matches) { colors.matches = matches; colors.dispatchEvent(new Event("change")); },
    changeVisibility(value) { page.hidden = value; page.dispatchEvent(new Event("visibilitychange")); },
    intersect(isIntersecting) { for (const observer of observations) if (observer.active) observer.callback([{ isIntersecting }]); },
    lose() { contextLost = true; enabled = false; canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })); },
    restore() { contextLost = false; enabled = false; canvas.dispatchEvent(new Event("webglcontextrestored")); },
  };
}

test("fluid quality policy bounds backing pixels, simulation dimensions and rendering cadence", () => {
  for (const compact of [false, true]) for (const [width, height, dpr] of [[600, 720, 2], [1920, 1080, 4], [390, 844, 3], [2000, 1500, 2], [1, 1, .25], [100000, 100000, 3], [0, -1, 1], [NaN, Infinity, 1], [600, 720, NaN], [600, 720, Infinity], [600, 720, -2]]) {
    const policy = fluidPolicy({ compact, width, height, dpr });
    for (const dimension of [policy.width, policy.height, ...policy.simulation, ...policy.dye]) assert.ok(Number.isInteger(dimension) && dimension >= 1);
    assert.ok(policy.width <= 1100 && policy.height <= 1100);
    assert.ok(policy.width * policy.height <= 520000);
    assert.ok(Math.max(...policy.simulation) <= (compact ? 80 : 112));
    assert.ok(Math.max(...policy.dye) <= (compact ? 176 : 256));
    assert.ok(policy.frameInterval >= 1000 / 30);
    assert.ok(policy.iterations >= 1 && policy.iterations <= 12);
  }
});

test("adaptive quality reduces already-capped high-DPR output and bounds quality input", () => {
  for (const compact of [false, true]) {
    const input = { compact, width: 600, height: 720, dpr: 3 };
    const full = fluidPolicy(input);
    const degraded = fluidPolicy({ ...input, quality: .7 });
    assert.ok(degraded.width < full.width && degraded.height < full.height);
    assert.ok(degraded.width * degraded.height <= full.width * full.height * .5,
      "quality must reduce actual backing pixels even after DPR/area caps apply");
    assert.equal(degraded.iterations, 6);
    assert.deepEqual(fluidPolicy({ ...input, quality: -.5 }), fluidPolicy({ ...input, quality: .5 }));
    assert.deepEqual(fluidPolicy({ ...input, quality: 2 }), full);
    assert.deepEqual(fluidPolicy({ ...input, quality: NaN }), full);
    assert.deepEqual(fluidPolicy({ ...input, quality: Infinity }), full);
  }
});

test("real renderer uses disjoint read/write targets and clamps stalled-frame time steps", () => {
  const fixture = browser();
  const renderer = fixture.start();
  assert.ok(renderer);
  assert.equal(fixture.host.dataset.renderer, "fluid");
  assert.equal(fixture.frames.size, 1);
  fixture.frame(100);
  fixture.frame(10000);
  assert.equal(fixture.counters.feedback, 0);
  assert.ok(fixture.counters.dt.length > 0);
  assert.ok(fixture.counters.dt.every(value => Number.isFinite(value) && value > 0 && value <= .05));
  assert.equal(fixture.frames.size, 1);
  renderer.dispose();
});

test("hidden, offscreen, paused, reduced-motion and forced-color states cancel the only animation frame", () => {
  const fixture = browser();
  const renderer = fixture.start();
  assert.ok(renderer);
  for (const [stop, resume] of [
    [() => fixture.changeVisibility(true), () => fixture.changeVisibility(false)],
    [() => fixture.intersect(false), () => fixture.intersect(true)],
    [() => renderer.setPaused(true), () => renderer.setPaused(false)],
    [() => fixture.changeMotion(true), () => fixture.changeMotion(false)],
    [() => fixture.changeColors(true), () => fixture.changeColors(false)],
  ]) {
    stop();
    assert.equal(fixture.frames.size, 0);
    const draws = fixture.counters.draws;
    fixture.frame(10000);
    assert.equal(fixture.counters.draws, draws);
    resume();
    assert.equal(fixture.frames.size, 1);
  }
  renderer.dispose();
});

test("initially hidden, reduced-motion or forced-color renderer never starts an animation loop", () => {
  for (const options of [{ hidden: true }, { reduced: true }, { forcedColors: true }]) {
    const fixture = browser(options);
    const renderer = fixture.start();
    assert.ok(renderer);
    assert.equal(fixture.frames.size, 0);
    const draws = fixture.counters.draws;
    fixture.frame(500);
    assert.equal(fixture.counters.draws, draws);
    renderer.dispose();
  }
});

test("restoring a context re-enables float rendering before reallocating targets", () => {
  const fixture = browser();
  const renderer = fixture.start();
  assert.ok(renderer);
  const firstExtensionCalls = fixture.counters.extensions;
  fixture.lose();
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.host.dataset.renderer, "fallback");
  fixture.restore();
  assert.ok(fixture.counters.extensions > firstExtensionCalls, "EXT_color_buffer_float must be enabled again after context restore");
  assert.equal(fixture.host.dataset.renderer, "fluid");
  assert.equal(fixture.frames.size, 1);
  fixture.frame(100);
  assert.equal(fixture.counters.feedback, 0);
  renderer.dispose();
});

test("context restoration retains measured output degradation and the reduced solver workload", () => {
  const fixture = browser();
  const renderer = fixture.start();
  assert.ok(renderer);
  const originalPixels = fixture.canvas.width * fixture.canvas.height;
  // Deliberately slow callbacks exercise the real controller's measurement gate.
  for (let index = 1; index <= 90; index++) fixture.frame(index * 100);
  const degradedWidth = fixture.canvas.width, degradedHeight = fixture.canvas.height;
  assert.ok(degradedWidth * degradedHeight < originalPixels * .51,
    "sustained slow frames must reduce backing pixels, including on a capped DPR2 device");
  const beforeDegradedFrame = fixture.counters.draws;
  fixture.frame(9100);
  const degradedWorkload = fixture.counters.draws - beforeDegradedFrame;
  assert.ok(degradedWorkload > 0);
  fixture.lose();
  fixture.restore();
  assert.equal(fixture.host.dataset.renderer, "fluid");
  assert.equal(fixture.canvas.width, degradedWidth);
  assert.equal(fixture.canvas.height, degradedHeight);
  const beforeRestoredFrame = fixture.counters.draws;
  fixture.frame(9200);
  assert.equal(fixture.counters.draws - beforeRestoredFrame, degradedWorkload,
    "a restored context must retain the reduced Jacobi workload");
  assert.equal(fixture.frames.size, 1);
  assert.equal(fixture.counters.feedback, 0);
  renderer.dispose();
});

test("initialization failures release partial GPU resources without installing listeners or scheduling work", () => {
  for (const options of [{ missingExtension: true }, { badFramebuffer: true }, { badShader: true }]) {
    const fixture = browser(options);
    assert.equal(fixture.start(), null);
    assert.equal(fixture.frames.size, 0);
    for (const [name, resources] of Object.entries(fixture.resources)) assert.equal(resources.size, 0, `${name} resources leaked`);
    assert.equal(fixture.canvas.count + fixture.page.count + fixture.view.count + fixture.interaction.count + fixture.preference.count + fixture.colors.count, 0);
  }
});

test("disposal cancels work, removes observers and listeners, and releases every owned GPU resource", () => {
  const fixture = browser();
  const renderer = fixture.start();
  assert.ok(renderer);
  renderer.dispose();
  assert.equal(fixture.frames.size, 0);
  for (const [name, resources] of Object.entries(fixture.resources)) assert.equal(resources.size, 0, `${name} resources leaked`);
  assert.equal(fixture.canvas.count + fixture.page.count + fixture.view.count + fixture.interaction.count + fixture.preference.count + fixture.colors.count, 0);
  assert.ok(fixture.observations.every(observer => !observer.active));
  assert.ok(fixture.resizes.every(observer => !observer.active));
  assert.equal(fixture.host.dataset.renderer, "fallback");
  const draws = fixture.counters.draws;
  fixture.changeVisibility(false); fixture.changeMotion(false); fixture.frame(500);
  assert.equal(fixture.counters.draws, draws);
});
