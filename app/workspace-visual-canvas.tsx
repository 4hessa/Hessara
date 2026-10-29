"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, MathUtils, Sphere, Vector3, type Group } from "three";
import { createRibbonData, fillRibbonPositions, ribbonQuality, type WorkspaceSceneMode } from "@/lib/workspace-ribbon";

type Pointer = RefObject<{ x: number; y: number }>;

function Ribbon({ compact, phase, index, pointer }: { compact: boolean; phase: number; index: number; pointer: Pointer }) {
  const time = useRef(0);
  const response = useRef(0);
  const geometry = useMemo(() => {
    const data = createRibbonData(compact, phase);
    const shape = new BufferGeometry();
    shape.setAttribute("position", new BufferAttribute(data.positions, 3).setUsage(DynamicDrawUsage));
    shape.setIndex(new BufferAttribute(data.indices, 1));
    shape.computeVertexNormals();
    const normals = shape.getAttribute("normal");
    if (normals instanceof BufferAttribute) normals.setUsage(DynamicDrawUsage);
    // The analytic radius/width bounds fit inside 1.8 units for every frame.
    shape.boundingSphere = new Sphere(new Vector3(), 1.8);
    return { shape, ...data };
  }, [compact, phase]);
  useEffect(() => () => geometry.shape.dispose(), [geometry]);

  useFrame((_, delta) => {
    time.current += Math.min(delta, .05) * .42;
    response.current = MathUtils.damp(response.current, pointer.current.x * .14 + pointer.current.y * .09, 3, Math.min(delta, .05));
    fillRibbonPositions(geometry.positions, geometry.segments, geometry.crossSegments, time.current, phase + response.current);
    geometry.shape.getAttribute("position").needsUpdate = true;
    geometry.shape.computeVertexNormals();
  });

  return <mesh rotation={[index * .68 - .5, index * .45 - .3, index * .72]}>
    <primitive attach="geometry" object={geometry.shape} />
    <meshPhysicalMaterial color={["#bfd7ea", "#c6cdd8", "#5f7fa6"][index]} metalness={.28} roughness={.28} clearcoat={.65} clearcoatRoughness={.34} side={DoubleSide} />
  </mesh>;
}

function Sculpture({ mode, compact, pointer }: { mode: WorkspaceSceneMode; compact: boolean; pointer: Pointer }) {
  const group = useRef<Group>(null);
  const { ribbons } = ribbonQuality(compact);
  useFrame((_, delta) => {
    if (!group.current) return;
    group.current.rotation.y = MathUtils.damp(group.current.rotation.y, pointer.current.x * .16, 4, delta);
    group.current.rotation.x = MathUtils.damp(group.current.rotation.x, pointer.current.y * .1, 4, delta);
  });
  const scale = mode === "comparison" ? .9 : mode === "empty" ? .94 : 1;
  return <group ref={group} scale={scale}>
    {Array.from({ length: ribbons }, (_, index) => <Ribbon key={index} compact={compact} index={index} phase={index * 2.1} pointer={pointer} />)}
  </group>;
}

function RendererHealth({ onFailure, onReady }: { onFailure: () => void; onReady: (ready: boolean) => void }) {
  const gl = useThree(state => state.gl);
  const firstFrame = useRef(false);
  useFrame(() => { if (!firstFrame.current) { firstFrame.current = true; onReady(true); } });
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure(); };
    const element = gl.domElement;
    element.addEventListener("webglcontextlost", lost);
    return () => { element.removeEventListener("webglcontextlost", lost); onReady(false); };
  }, [gl, onFailure, onReady]);
  return null;
}

export default function WorkspaceVisualCanvas({ mode, compact, pointer, onFailure, onReady }: {
  mode: WorkspaceSceneMode;
  compact: boolean;
  pointer: Pointer;
  onFailure: () => void;
  onReady: (ready: boolean) => void;
}) {
  return <Canvas className="hessara-scene-canvas" dpr={[1, ribbonQuality(compact).dpr]} camera={{ position: [0, 0, 5.7], fov: 39 }} gl={{ alpha: true, antialias: !compact, powerPreference: "low-power", preserveDrawingBuffer: false, depth: true, stencil: false }} fallback={null}>
    <ambientLight intensity={1.35} />
    <directionalLight position={[3, 4, 5]} intensity={3.6} color="#f7f9fc" />
    <directionalLight position={[-4, 1, -2]} intensity={2.8} color="#bfd7ea" />
    <Sculpture mode={mode} compact={compact} pointer={pointer} />
    <RendererHealth onFailure={onFailure} onReady={onReady} />
  </Canvas>;
}
