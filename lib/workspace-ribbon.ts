export type WorkspaceSceneMode = "overview" | "discovery" | "comparison" | "empty";

export type ScenePolicy = {
  active: boolean;
  inView: boolean;
  pageVisible: boolean;
  reducedMotion: boolean;
  paused: boolean;
  failed: boolean;
  saveData: boolean;
  forcedColors: boolean;
};

/** No renderer is mounted while the illustration cannot benefit the viewer. */
export function mayRenderWorkspaceScene(policy: ScenePolicy): boolean {
  return policy.active && policy.inView && policy.pageVisible &&
    !policy.reducedMotion && !policy.paused && !policy.failed && !policy.saveData && !policy.forcedColors;
}

export function ribbonQuality(compact: boolean) {
  return compact
    ? { segments: 32, crossSegments: 4, ribbons: 2, dpr: 1 }
    : { segments: 64, crossSegments: 6, ribbons: 3, dpr: 1.4 };
}

/** A closed, breathing strip. The local twist and radius change, not just its pose. */
function writeRibbonPoint(target: number[] | Float32Array, offset: number, u: number, v: number, time: number, phase: number): void {
  const theta = u * Math.PI * 2;
  const radius = 1.12 + .12 * Math.sin(3 * theta + time * .64 + phase);
  const width = .22 + .045 * Math.cos(2 * theta - time * .52 + phase);
  const twist = theta + .42 * Math.sin(2 * theta + time * .72 + phase) + phase * .35;
  const spread = v * width;
  const cosine = Math.cos(theta), sine = Math.sin(theta);
  target[offset] = radius * cosine + spread * cosine * Math.cos(twist);
  target[offset + 1] = radius * sine * .8 + spread * sine * Math.cos(twist);
  target[offset + 2] = .26 * Math.sin(2 * theta + time * .8 + phase) + spread * Math.sin(twist);
}

export function ribbonPoint(u: number, v: number, time: number, phase: number): [number, number, number] {
  const point: [number, number, number] = [0, 0, 0];
  writeRibbonPoint(point, 0, u, v, time, phase);
  return point;
}

export function fillRibbonPositions(positions: Float32Array, segments: number, crossSegments: number, time: number, phase: number): void {
  const columns = crossSegments + 1;
  for (let segment = 0; segment < segments; segment++) {
    for (let column = 0; column < columns; column++) {
      const offset = (segment * columns + column) * 3;
      writeRibbonPoint(positions, offset, segment / segments, column / crossSegments * 2 - 1, time, phase);
    }
  }
}

export function createRibbonData(compact: boolean, phase: number) {
  const { segments, crossSegments } = ribbonQuality(compact);
  const columns = crossSegments + 1;
  const positions = new Float32Array(segments * columns * 3);
  const indices = new Uint16Array(segments * crossSegments * 6);
  fillRibbonPositions(positions, segments, crossSegments, 0, phase);
  let offset = 0;
  for (let segment = 0; segment < segments; segment++) {
    const next = (segment + 1) % segments;
    for (let column = 0; column < crossSegments; column++) {
      const a = segment * columns + column, b = next * columns + column;
      indices.set([a, b, a + 1, b, b + 1, a + 1], offset);
      offset += 6;
    }
  }
  return { positions, indices, segments, crossSegments };
}

/** Lightweight original SVG silhouette, also used when WebGL or motion is unavailable. */
export function ribbonSilhouette(phase: number): string {
  const samples = 56;
  const points: string[] = [];
  for (const side of [-1, 1]) {
    for (let sample = 0; sample <= samples; sample++) {
      const u = side === -1 ? sample / samples : 1 - sample / samples;
      const [x, y, z] = ribbonPoint(u, side, 0, phase);
      points.push(`${(180 + x * 82 + z * 23).toFixed(2)},${(120 - y * 78 + z * 25).toFixed(2)}`);
    }
  }
  return `M${points.join(" L")} Z`;
}
