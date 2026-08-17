"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ============================================================
   Text-to-particle sampler
   Draws text to an offscreen canvas, reads pixels, picks
   bright pixels as target positions for particles.
   ============================================================ */

function sampleTextPoints(text: string, fontSize = 200): THREE.Vector3[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `900 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  const metrics = ctx.measureText(text);
  canvas.width = Math.ceil(metrics.width) + 40;
  canvas.height = fontSize * 1.4;
  // re-set after resize
  ctx.font = `900 ${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const points: THREE.Vector3[] = [];
  let seed = 1;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const step = 3; // sample every 3rd pixel for density control
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] > 128) {
        points.push(
          new THREE.Vector3(
            (x - canvas.width / 2) * 0.03,
            -(y - canvas.height / 2) * 0.03,
            (rng() - 0.5) * 0.5,
          ),
        );
      }
    }
  }
  return points;
}

function sampleSphere(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / count);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    points.push(
      new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      ),
    );
  }
  return points;
}

function sampleTorusKnot(count: number, radius: number): THREE.Vector3[] {
  const p = 2;
  const q = 3;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const r = radius * (2 + Math.cos(q * t)) * 0.4;
    points.push(
      new THREE.Vector3(
        r * Math.cos(p * t),
        r * Math.sin(p * t),
        (radius * 0.3) * Math.sin(q * t),
      ),
    );
  }
  return points;
}

/* ============================================================
   Particle System
   Morphs between sphere → text → torus knot → scatter
   based on scroll progress.
   ============================================================ */

const PARTICLE_COUNT = 12000;

function ParticleField({ scrollRef }: { scrollRef: React.RefObject<number> }) {
  const pointsRef = useRef<THREE.Points>(null);

  // Precompute morph targets
  const { positions, morphTargets, randomOffsets } = useMemo(() => {
    const textPoints = sampleTextPoints("1minyt", 220);
    const spherePoints = sampleSphere(PARTICLE_COUNT, 3.5);
    const knotPoints = sampleTorusKnot(PARTICLE_COUNT, 4);

    // Pad text points to PARTICLE_COUNT by cycling
    const textPadded: THREE.Vector3[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      textPadded.push(textPoints[i % textPoints.length]);
    }

    // Initial positions = sphere
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3] = spherePoints[i].x;
      pos[i * 3 + 1] = spherePoints[i].y;
      pos[i * 3 + 2] = spherePoints[i].z;
    }

    const rand = new Float32Array(PARTICLE_COUNT * 3);
    // Deterministic PRNG — avoids Math.random() in render (React Compiler purity)
    let seed = 42;
    const rng = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      rand[i * 3] = rng() - 0.5;
      rand[i * 3 + 1] = rng() - 0.5;
      rand[i * 3 + 2] = rng() - 0.5;
    }

    return {
      positions: pos,
      morphTargets: {
        sphere: spherePoints,
        text: textPadded,
        knot: knotPoints,
      },
      randomOffsets: rand,
    };
  }, []);

  useFrame((state) => {
    const points = pointsRef.current;
    if (!points) return;

    const t = state.clock.elapsedTime;
    const scroll = scrollRef.current; // 0 → 1 over full page scroll

    // Define morph keyframes:
    // 0.00–0.15  sphere → text (hero text assembles)
    // 0.15–0.40  text holds, gentle breathing
    // 0.40–0.60  text → torus knot (3D object forms)
    // 0.60–0.85  knot rotates, distorts
    // 0.85–1.00  scatter to particles
    let blend = 0;
    let phaseA: keyof typeof morphTargets = "sphere";
    let phaseB: keyof typeof morphTargets = "text";

    if (scroll < 0.15) {
      blend = scroll / 0.15;
      phaseA = "sphere";
      phaseB = "text";
    } else if (scroll < 0.40) {
      blend = 0;
      phaseA = "text";
      phaseB = "text";
    } else if (scroll < 0.60) {
      blend = (scroll - 0.40) / 0.20;
      phaseA = "text";
      phaseB = "knot";
    } else if (scroll < 0.85) {
      blend = 0;
      phaseA = "knot";
      phaseB = "knot";
    } else {
      blend = (scroll - 0.85) / 0.15;
      phaseA = "knot";
      phaseB = "sphere"; // scatter back to random sphere distribution
    }

    const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    const targetsA = morphTargets[phaseA];
    const targetsB = morphTargets[phaseB];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const a = targetsA[i];
      const b = targetsB[i];

      // Base lerp between morph targets
      let x = a.x + (b.x - a.x) * blend;
      let y = a.y + (b.y - a.y) * blend;
      let z = a.z + (b.z - a.z) * blend;

      // Per-particle noise for organic feel
      const ri = i * 3;
      const noise = Math.sin(t * 0.5 + i * 0.01) * 0.04;
      x += randomOffsets[ri] * noise;
      y += randomOffsets[ri + 1] * noise;
      z += randomOffsets[ri + 2] * noise;

      // Rotation of entire formation during knot phase
      if (scroll >= 0.40 && scroll < 0.85) {
        const angle = t * 0.3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = x * cos - z * sin;
        const nz = x * sin + z * cos;
        x = nx;
        z = nz;
      }

      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }

    posAttr.needsUpdate = true;

    // Gentle group rotation on hero
    if (scroll < 0.40) {
      points.rotation.y = Math.sin(t * 0.15) * 0.1;
      points.rotation.x = Math.cos(t * 0.1) * 0.05;
    } else {
      points.rotation.y += 0.002;
      points.rotation.x = Math.sin(t * 0.2) * 0.08;
    }
  });

  // Color gradient: blue → purple
  const colors = useMemo(() => {
    const c = new Float32Array(PARTICLE_COUNT * 3);
    const blue = new THREE.Color("#5b9eff");
    const purple = new THREE.Color("#7c5cff");
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mix = i / PARTICLE_COUNT;
      const col = blue.clone().lerp(purple, mix);
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    return c;
  }, []);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={PARTICLE_COUNT}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colors, 3]}
          count={PARTICLE_COUNT}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* ============================================================
   Wireframe icosahedron — the "B" element
   Appears during the feature stack section, distorts on scroll
   ============================================================ */

function DistortIco({ scrollRef }: { scrollRef: React.RefObject<number> }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, origPos } = useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(2.2, 4);
    const orig = new Float32Array(
      (geo.attributes.position as THREE.BufferAttribute).array,
    );
    return { geometry: geo, origPos: orig };
  }, []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const t = state.clock.elapsedTime;
    const scroll = scrollRef.current;

    // Only visible in mid-scroll range
    const visibility = scroll > 0.30 && scroll < 0.90 ? 1 : 0;
    mesh.visible = visibility > 0;

    if (!mesh.visible) return;

    // Rotate
    mesh.rotation.y = t * 0.2 + scroll * Math.PI * 2;
    mesh.rotation.x = Math.sin(t * 0.15) * 0.3;

    // Distort vertices based on scroll
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const distort = 0.15 + scroll * 0.3;

    for (let i = 0; i < arr.length; i += 3) {
      const x = origPos[i];
      const y = origPos[i + 1];
      const z = origPos[i + 2];
      const noise =
        Math.sin(x * 2 + t) * Math.cos(y * 2 + t * 0.7) * Math.sin(z * 2 + t * 0.5);
      const scale = 1 + noise * distort;
      arr[i] = x * scale;
      arr[i + 1] = y * scale;
      arr[i + 2] = z * scale;
    }
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();

    // Scale up slightly as you scroll deeper
    const s = 1 + scroll * 0.3;
    mesh.scale.setScalar(s);
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <meshBasicMaterial
        color="#5b9eff"
        wireframe
        transparent
        opacity={0.25}
      />
    </mesh>
  );
}

/* ============================================================
   Camera rig — subtle parallax based on scroll + mouse
   ============================================================ */

function CameraRig({ scrollRef }: { scrollRef: React.RefObject<number> }) {
  const { camera } = useThree();
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // eslint-disable-next-line react-hooks/immutability -- R3F useFrame mutates three.js objects by design
  useFrame(() => {
    const scroll = scrollRef.current;

    // Camera moves forward slightly as you scroll
    const targetZ = 8 - scroll * 2;
    // Lerp camera position
    // eslint-disable-next-line react-hooks/immutability -- three.js camera mutation is the R3F pattern
    camera.position.z += (targetZ - camera.position.z) * 0.05;
    camera.position.x += (mouse.current.x * 0.5 - camera.position.x) * 0.03;
    camera.position.y += (mouse.current.y * 0.3 - camera.position.y) * 0.03;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

/* ============================================================
   Main exported scene
   ============================================================ */

export default function Scene3D({
  scrollRef,
}: {
  scrollRef: React.RefObject<number>;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 50 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    >
      <CameraRig scrollRef={scrollRef} />
      <ParticleField scrollRef={scrollRef} />
      <DistortIco scrollRef={scrollRef} />
    </Canvas>
  );
}
