import test from "node:test";
import assert from "node:assert/strict";
import { createRibbonData, fillRibbonPositions, mayRenderWorkspaceScene, ribbonPoint, ribbonQuality } from "../lib/workspace-ribbon.ts";

test("ribbon surfaces remain closed, finite and within their culling bounds while deforming", () => {
  for (const phase of [0, 2.1, 4.2]) {
    for (const time of [0, 1, 12, 1000]) {
      for (const side of [-1, 0, 1]) {
        const first = ribbonPoint(0, side, time, phase), last = ribbonPoint(1, side, time, phase);
        assert.ok(first.every((value, index) => Math.abs(value - last[index]) < 1e-10));
      }
      const data = createRibbonData(false, phase);
      fillRibbonPositions(data.positions, data.segments, data.crossSegments, time, phase);
      for (let offset = 0; offset < data.positions.length; offset += 3) {
        assert.ok(Number.isFinite(data.positions[offset]));
        assert.ok(Math.hypot(...data.positions.subarray(offset, offset + 3)) < 1.8);
      }
    }
  }
  const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
  const initial = distance(ribbonPoint(.1, 1, 0, 0), ribbonPoint(.4, -1, 0, 0));
  const deformed = distance(ribbonPoint(.1, 1, 3, 0), ribbonPoint(.4, -1, 3, 0));
  assert.ok(Math.abs(initial - deformed) > .03, "surface deformation must change internal distances, not merely rotate the mesh");
});

test("closed indexed topology is valid and mobile geometry has a smaller bounded budget", () => {
  const desktop = createRibbonData(false, 0), mobile = createRibbonData(true, 0);
  assert.ok(mobile.positions.length < desktop.positions.length / 2);
  for (const data of [desktop, mobile]) {
    const count = data.positions.length / 3;
    assert.ok(count <= 448);
    for (let offset = 0; offset < data.indices.length; offset += 3) {
      const triangle = [...data.indices.subarray(offset, offset + 3)];
      assert.ok(triangle.every(index => index >= 0 && index < count));
      assert.equal(new Set(triangle).size, 3);
    }
    assert.ok([...data.indices.subarray(-data.crossSegments * 6)].includes(0), "last surface strip joins its first row");
  }
  assert.equal(ribbonQuality(true).dpr, 1);
  assert.ok(ribbonQuality(false).dpr <= 1.5);
});

test("GPU activation fails closed for hidden, inactive, reduced-motion, paused and data-saving views", () => {
  const policy = { active: true, inView: true, pageVisible: true, reducedMotion: false, paused: false, failed: false, saveData: false, forcedColors: false };
  assert.equal(mayRenderWorkspaceScene(policy), true);
  for (const key of ["active", "inView", "pageVisible"]) assert.equal(mayRenderWorkspaceScene({ ...policy, [key]: false }), false, key);
  for (const key of ["reducedMotion", "paused", "failed", "saveData", "forcedColors"]) assert.equal(mayRenderWorkspaceScene({ ...policy, [key]: true }), false, key);
});
