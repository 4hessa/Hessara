"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Group } from "three";

function ComparisonSculpture() {
  const sculpture = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!sculpture.current) return;
    const time = clock.getElapsedTime();
    sculpture.current.rotation.y = Math.sin(time * 0.22) * 0.13;
    sculpture.current.rotation.z = Math.sin(time * 0.16) * 0.035;
    sculpture.current.position.y = Math.sin(time * 0.33) * 0.055;
  });

  return (
    <group ref={sculpture}>
      <mesh rotation={[0.3, 0.42, -0.48]}>
        <torusGeometry args={[1.31, 0.045, 10, 120]} />
        <meshStandardMaterial color="#775b6e" roughness={0.88} />
      </mesh>
      <mesh rotation={[-0.32, -0.56, 0.46]} position={[0, 0, -0.08]}>
        <torusGeometry args={[1.31, 0.04, 10, 120]} />
        <meshStandardMaterial color="#789b99" roughness={0.9} />
      </mesh>
      <mesh rotation={[0.66, 0.15, 1.13]} position={[0, 0, -0.17]}>
        <torusGeometry args={[1.2, 0.036, 10, 120]} />
        <meshStandardMaterial color="#aa93b6" roughness={0.9} />
      </mesh>
      <mesh scale={[1, 0.88, 0.57]}>
        <sphereGeometry args={[0.65, 32, 24]} />
        <meshStandardMaterial color="#cabecb" roughness={0.5} metalness={0.02} />
      </mesh>
      <mesh position={[-0.16, 0.19, 0.35]} scale={[0.55, 0.48, 0.2]}>
        <sphereGeometry args={[0.34, 24, 16]} />
        <meshStandardMaterial color="#eee4e7" roughness={0.84} />
      </mesh>
      <mesh position={[-1.02, 0.86, 0.2]}>
        <sphereGeometry args={[0.15, 18, 12]} />
        <meshStandardMaterial color="#7f9390" roughness={0.78} />
      </mesh>
      <mesh position={[1.2, 0.69, 0.16]}>
        <sphereGeometry args={[0.12, 18, 12]} />
        <meshStandardMaterial color="#a18eaa" roughness={0.78} />
      </mesh>
      <mesh position={[0.62, -1.18, 0.27]}>
        <sphereGeometry args={[0.14, 18, 12]} />
        <meshStandardMaterial color="#a17889" roughness={0.78} />
      </mesh>
    </group>
  );
}

export function HeroArtScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 30 }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
    >
      <ambientLight intensity={2.2} />
      <directionalLight position={[-2, 3, 5]} intensity={2.1} />
      <directionalLight position={[3, -1, 2]} intensity={0.6} color="#f5e5e9" />
      <ComparisonSculpture />
    </Canvas>
  );
}
