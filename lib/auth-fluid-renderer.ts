import { fluidFragments, fluidVertex } from "./auth-fluid-shaders";
import { fluidPolicy } from "./auth-fluid-policy";

type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number };
type Pair = { read: Target; write: Target; swap(): void };
type Program = { value: WebGLProgram; uniforms: Map<string, WebGLUniformLocation> };
export type AuthFluidRenderer = { setPaused(value: boolean): void; dispose(): void };

/** One bounded WebGL2 solver, one RAF owner. No React state changes per frame. */
export function createAuthFluidRenderer(canvas: HTMLCanvasElement, host: HTMLDivElement): AuthFluidRenderer | null {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return null;
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const contrast = matchMedia("(forced-colors: active)");
  const device = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const compact = (device.deviceMemory ?? 8) <= 4 || navigator.hardwareConcurrency <= 4 || device.connection?.saveData === true || window.innerWidth < 740;
  let policy = fluidPolicy({ compact, width: 600, height: 720 });
  let targets: Target[] = [], programs: Program[] = [];
  let quad: WebGLBuffer | null = null, vao: WebGLVertexArrayObject | null = null;
  let velocity: Pair, dye: Pair, pressure: Pair, divergence: Target;
  let stages: Record<keyof typeof fluidFragments, Program>;
  let disposed = false, lost = false, failed = false, paused = false, inView = true;
  let raf = 0, lastPaint = 0, time = 7.3, quality = 1, frames = 0, delayed = 0;
  const pointer = [-1, -1, 0, 0];

  function release() {
    for (const target of targets) { gl!.deleteFramebuffer(target.framebuffer); gl!.deleteTexture(target.texture); }
    for (const program of programs) gl!.deleteProgram(program.value);
    gl!.deleteBuffer(quad); gl!.deleteVertexArray(vao);
    targets = []; programs = []; quad = null; vao = null;
  }
  function program(fragment: string): Program {
    const shaders: WebGLShader[] = [];
    const value = gl!.createProgram();
    if (!value) throw new Error("FLUID_PROGRAM_UNAVAILABLE");
    try {
      for (const [type, source] of [[gl!.VERTEX_SHADER, fluidVertex], [gl!.FRAGMENT_SHADER, fragment]] as const) {
        const shader = gl!.createShader(type);
        if (!shader) throw new Error("FLUID_SHADER_UNAVAILABLE");
        shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader);
        if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error("FLUID_SHADER_COMPILE_FAILED");
        gl!.attachShader(value, shader);
      }
      gl!.bindAttribLocation(value, 0, "position"); gl!.linkProgram(value);
      if (!gl!.getProgramParameter(value, gl!.LINK_STATUS)) throw new Error("FLUID_SHADER_LINK_FAILED");
      const uniforms = new Map<string, WebGLUniformLocation>();
      for (let i = 0; i < gl!.getProgramParameter(value, gl!.ACTIVE_UNIFORMS); i++) {
        const name = gl!.getActiveUniform(value, i)?.name;
        if (name) { const location = gl!.getUniformLocation(value, name); if (location !== null) uniforms.set(name, location); }
      }
      const result = { value, uniforms }; programs.push(result); return result;
    } catch (error) { gl!.deleteProgram(value); throw error; }
    finally { for (const shader of shaders) gl!.deleteShader(shader); }
  }
  function target(width: number, height: number): Target {
    const texture = gl!.createTexture(), framebuffer = gl!.createFramebuffer();
    if (!texture || !framebuffer) { gl!.deleteTexture(texture); gl!.deleteFramebuffer(framebuffer); throw new Error("FLUID_TARGET_UNAVAILABLE"); }
    const result = { texture, framebuffer, width, height }; targets.push(result);
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA16F, width, height, 0, gl!.RGBA, gl!.HALF_FLOAT, null);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, texture, 0);
    if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) throw new Error("FLUID_TARGET_UNSUPPORTED");
    gl!.viewport(0, 0, width, height); gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT);
    return result;
  }
  function pair(width: number, height: number): Pair {
    return { read: target(width, height), write: target(width, height), swap() { [this.read, this.write] = [this.write, this.read]; } };
  }
  function bind(stage: Program) { gl!.useProgram(stage.value); gl!.bindVertexArray(vao); }
  function scalar(stage: Program, name: string, value: number) { gl!.uniform1f(stage.uniforms.get(name) ?? null, value); }
  function vector(stage: Program, name: string, x: number, y: number) { gl!.uniform2f(stage.uniforms.get(name) ?? null, x, y); }
  function sampler(stage: Program, name: string, value: Target, slot: number) {
    gl!.activeTexture(gl!.TEXTURE0 + slot); gl!.bindTexture(gl!.TEXTURE_2D, value.texture); gl!.uniform1i(stage.uniforms.get(name) ?? null, slot);
  }
  function paint(destination: Target | null) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, destination?.framebuffer ?? null);
    gl!.viewport(0, 0, destination?.width ?? canvas.width, destination?.height ?? canvas.height);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }
  function transport(field: Pair, dt: number, decay: number) {
    const stage = stages.transport; bind(stage);
    sampler(stage, "velocity", velocity.read, 0); sampler(stage, "source", field.read, 1);
    vector(stage, "velocityCell", 1 / velocity.read.width, 1 / velocity.read.height);
    vector(stage, "sourceCell", 1 / field.read.width, 1 / field.read.height);
    scalar(stage, "dt", dt); scalar(stage, "decay", decay); paint(field.write); field.swap();
  }
  function step(dt: number, seed = 0) {
    time += dt;
    transport(velocity, dt, .12);
    let stage = stages.force; bind(stage); sampler(stage, "velocity", velocity.read, 0);
    scalar(stage, "time", time); scalar(stage, "dt", dt); scalar(stage, "aspect", canvas.width / canvas.height);
    gl!.uniform4f(stage.uniforms.get("pointer") ?? null, pointer[0], pointer[1], pointer[2], pointer[3]);
    paint(velocity.write); velocity.swap(); pointer[2] *= .88; pointer[3] *= .88;
    stage = stages.divergence; bind(stage); sampler(stage, "velocity", velocity.read, 0);
    vector(stage, "cell", 1 / velocity.read.width, 1 / velocity.read.height); paint(divergence);
    stage = stages.pressure; bind(stage); sampler(stage, "divergence", divergence, 1);
    vector(stage, "cell", 1 / pressure.read.width, 1 / pressure.read.height);
    for (let i = 0; i < policy.iterations; i++) { sampler(stage, "pressure", pressure.read, 0); paint(pressure.write); pressure.swap(); }
    stage = stages.project; bind(stage); sampler(stage, "pressure", pressure.read, 0); sampler(stage, "velocity", velocity.read, 1);
    vector(stage, "cell", 1 / velocity.read.width, 1 / velocity.read.height); paint(velocity.write); velocity.swap();
    transport(dye, dt, .38);
    stage = stages.pigment; bind(stage); sampler(stage, "dye", dye.read, 0);
    scalar(stage, "time", time); scalar(stage, "dt", dt); scalar(stage, "seed", seed); scalar(stage, "aspect", canvas.width / canvas.height);
    paint(dye.write); dye.swap();
  }
  function display() {
    if (disposed || lost || failed) return;
    const stage = stages.display; bind(stage); sampler(stage, "dye", dye.read, 0);
    vector(stage, "cell", 1 / dye.read.width, 1 / dye.read.height); scalar(stage, "aspect", canvas.width / canvas.height); scalar(stage, "time", time);
    paint(null); host.dataset.renderer = "fluid";
  }
  function resizeCanvas() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height || disposed || lost || failed) return;
    const next = fluidPolicy({ compact, width, height, dpr: window.devicePixelRatio || 1, quality });
    policy.iterations = next.iterations;
    canvas.width = next.width; canvas.height = next.height;
    display();
  }
  function initialize() {
    release();
    // Extension enablement is lost with the context and must be requested again.
    if (!gl!.getExtension("EXT_color_buffer_float")) throw new Error("FLUID_FLOAT_TARGETS_UNSUPPORTED");
    const { width, height } = host.getBoundingClientRect();
    policy = fluidPolicy({ compact, width, height, dpr: window.devicePixelRatio || 1, quality });
    frames = 0; delayed = 0;
    canvas.width = policy.width; canvas.height = policy.height;
    quad = gl!.createBuffer(); vao = gl!.createVertexArray();
    if (!quad || !vao) throw new Error("FLUID_GEOMETRY_UNAVAILABLE");
    gl!.bindVertexArray(vao); gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(0); gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0);
    gl!.disable(gl!.BLEND); gl!.disable(gl!.DEPTH_TEST);
    stages = Object.fromEntries(Object.entries(fluidFragments).map(([name, source]) => [name, program(source)])) as typeof stages;
    velocity = pair(policy.simulation[0], policy.simulation[1]); pressure = pair(policy.simulation[0], policy.simulation[1]);
    divergence = target(policy.simulation[0], policy.simulation[1]); dye = pair(policy.dye[0], policy.dye[1]);
    step(1 / 30, 1.4);
    for (let i = 0; i < 5; i++) step(1 / 30);
    display();
  }
  function active() { return !disposed && !lost && !failed && !paused && !preference.matches && !contrast.matches && !document.hidden && inView; }
  function tick(now: number) {
    raf = 0;
    if (!active()) return;
    if (!lastPaint || now - lastPaint >= policy.frameInterval - .5) {
      const elapsed = lastPaint ? now - lastPaint : policy.frameInterval;
      if (elapsed > policy.frameInterval * 1.75) delayed++;
      step(Math.min(elapsed / 1000, .05)); display(); lastPaint = now; frames++;
      if (frames === 90) {
        if (delayed > 18 && quality > .7) { quality = .7; resizeCanvas(); }
        frames = 0; delayed = 0;
      }
    }
    raf = requestAnimationFrame(tick);
  }
  function reconcile() { cancelAnimationFrame(raf); raf = 0; lastPaint = 0; host.dataset.motion = active() ? "running" : "paused"; if (active()) raf = requestAnimationFrame(tick); }
  function contextLost(event: Event) { event.preventDefault(); lost = true; host.dataset.renderer = "fallback"; reconcile(); release(); }
  function contextRestored() {
    lost = false; failed = false;
    try { initialize(); } catch { failed = true; release(); host.dataset.renderer = "fallback"; }
    reconcile();
  }
  function move(event: PointerEvent) {
    if (!active() || event.pointerType === "touch") return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width, y = 1 - (event.clientY - rect.top) / rect.height;
    pointer[2] = pointer[0] < 0 ? 0 : Math.max(-1, Math.min(1, (x - pointer[0]) * 45));
    pointer[3] = pointer[1] < 0 ? 0 : Math.max(-1, Math.min(1, (y - pointer[1]) * 45));
    pointer[0] = x; pointer[1] = y;
  }
  function leave() { pointer[0] = -1; pointer[1] = -1; pointer[2] = 0; pointer[3] = 0; }
  try { initialize(); } catch { failed = true; release(); gl.getExtension("WEBGL_lose_context")?.loseContext(); return null; }
  const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resizeCanvas);
  const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; reconcile(); }, { threshold: .02 });
  resizeObserver?.observe(host); observer?.observe(host);
  const interaction = host.parentElement;
  interaction?.addEventListener("pointermove", move, { passive: true }); interaction?.addEventListener("pointerleave", leave);
  canvas.addEventListener("webglcontextlost", contextLost); canvas.addEventListener("webglcontextrestored", contextRestored);
  document.addEventListener("visibilitychange", reconcile); preference.addEventListener("change", reconcile);
  contrast.addEventListener("change", reconcile);
  window.addEventListener("resize", resizeCanvas, { passive: true });
  reconcile();
  return {
    setPaused(value) { paused = value; reconcile(); },
    dispose() {
      disposed = true; reconcile(); observer?.disconnect(); resizeObserver?.disconnect();
      interaction?.removeEventListener("pointermove", move); interaction?.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("webglcontextlost", contextLost); canvas.removeEventListener("webglcontextrestored", contextRestored);
      document.removeEventListener("visibilitychange", reconcile); preference.removeEventListener("change", reconcile); window.removeEventListener("resize", resizeCanvas);
      contrast.removeEventListener("change", reconcile);
      release(); host.dataset.renderer = "fallback"; if (!lost) gl!.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
