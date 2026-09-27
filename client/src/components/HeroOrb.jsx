import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, Color, NormalBlending } from "three";
import { useThemeColors } from "../hooks/useThemeColors.js";
import CanvasBoundary from "./CanvasBoundary.jsx";

// The orb's surface: a sphere pushed in and out by slowly moving 3D noise
// (it "breathes"), brighter at the edges (fresnel), like glass lit from behind.
const orbVertex = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vNoise;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p *= 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    float n = fbm(normal * 1.6 + vec3(0.0, uTime * 0.15, uTime * 0.1));
    vNoise = n;
    vec3 displaced = position + normal * (n - 0.5) * 0.18;
    vec4 view = modelViewMatrix * vec4(displaced, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-view.xyz);
    gl_Position = projectionMatrix * view;
  }
`;

const orbFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uGlow;
  varying vec3 vNormal;
  varying vec3 vView;
  varying float vNoise;

  void main() {
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.2);
    vec3 color = mix(uColor, uGlow, clamp(fresnel * 0.9 + vNoise * 0.3, 0.0, 1.0));
    gl_FragColor = vec4(color, 0.6 + fresnel * 0.4);
  }
`;

// Round, soft points ("messages") that get smaller further away.
const pointsVertex = /* glsl */ `
  uniform float uSize;
  attribute float aScale;
  void main() {
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uSize * aScale / -view.z;
  }
`;

const pointsFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    float alpha = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha * 0.9);
  }
`;

// Fixed pseudo-random numbers, so the rings look the same on every visit.
const random = (() => {
  let seed = 7;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
})();

// Points on a flat ring around the orb, with a little spread.
const ring = (count, radius, spread) => {
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const r = radius + (random() - 0.5) * spread;
    positions.set([Math.cos(angle) * r, (random() - 0.5) * spread * 0.4, Math.sin(angle) * r], i * 3);
    scales[i] = 0.5 + random();
  }
  return { positions, scales };
};
const RINGS = [
  { ...ring(200, 1.45, 0.3), tilt: [1.15, 0, 0.35], speed: 0.18 },
  { ...ring(80, 1.65, 0.2), tilt: [1.35, 0, -0.6], speed: -0.1 },
];

const Ring = ({ positions, scales, tilt, speed, color, size, blending }) => {
  const spin = useRef();
  const material = useRef();
  const dpr = useThree((state) => state.viewport.dpr);
  const [uniforms] = useState(() => ({ uColor: { value: new Color() }, uSize: { value: 0 } }));
  useEffect(() => {
    material.current.uniforms.uColor.value.set(color);
    material.current.uniforms.uSize.value = size * dpr; // gl_PointSize is in device pixels
  }, [color, size, dpr]);
  useFrame((_, delta) => {
    spin.current.rotation.y += delta * speed;
  });
  return (
    <group rotation={tilt}>
      <points ref={spin}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
        </bufferGeometry>
        <shaderMaterial
          ref={material}
          uniforms={uniforms}
          vertexShader={pointsVertex}
          fragmentShader={pointsFragment}
          transparent
          depthWrite={false}
          blending={blending}
        />
      </points>
    </group>
  );
};

// Follows the pointer a little (anywhere on the page), and turns slowly.
const Orb = ({ color, glow, pointer }) => {
  const group = useRef();
  const material = useRef();
  const [uniforms] = useState(() => ({ uTime: { value: 0 }, uColor: { value: new Color() }, uGlow: { value: new Color() } }));
  useEffect(() => {
    material.current.uniforms.uColor.value.set(color);
    material.current.uniforms.uGlow.value.set(glow);
  }, [color, glow]);
  useFrame((_, delta) => {
    material.current.uniforms.uTime.value += delta;
    const { x, y } = pointer.current;
    const ease = Math.min(1, delta * 2);
    group.current.rotation.y += (x * 0.4 - group.current.rotation.y) * ease;
    group.current.rotation.x += (-y * 0.25 - group.current.rotation.x) * ease;
  });
  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.05, 48]} />
        <shaderMaterial ref={material} uniforms={uniforms} vertexShader={orbVertex} fragmentShader={orbFragment} transparent />
      </mesh>
    </group>
  );
};

// Landing hero decoration: an "encrypted orb" with messages circling it.
// Loaded only on large screens without reduced motion (see Landing), drawn
// only while on screen and the tab is visible, and faded in when ready.
// Decorative: hidden from screen readers, never takes clicks.
const HeroOrb = () => {
  const theme = useThemeColors();
  const wrapper = useRef();
  const pointer = useRef({ x: 0, y: 0 });
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => !document.hidden);
  const [ready, setReady] = useState(false);
  const running = onScreen && tabVisible;

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting));
    observer.observe(wrapper.current);
    const handleVisibility = () => setTabVisible(!document.hidden);
    const handlePointer = (event) => {
      pointer.current = { x: (event.clientX / innerWidth) * 2 - 1, y: (event.clientY / innerHeight) * 2 - 1 };
    };
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pointermove", handlePointer, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pointermove", handlePointer);
    };
  }, []);

  // On a dark page the edge glows (light rim, deep centre); on a white page a
  // light rim would vanish, so there the centre is light and the edge deep.
  const { centre, edge, particles } = useMemo(() => {
    const hex = (color) => "#" + color.getHexString();
    const light = hex(new Color(theme.primary).lerp(new Color("#ffffff"), theme.dark ? 0.55 : 0.3));
    const deep = hex(new Color(theme.primary).lerp(new Color(theme.background), 0.35));
    return theme.dark ? { centre: deep, edge: light, particles: light } : { centre: light, edge: theme.primary, particles: theme.primary };
  }, [theme.primary, theme.background, theme.dark]);

  return (
    <div
      ref={wrapper}
      aria-hidden="true"
      data-running={running}
      className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
    >
      <CanvasBoundary>
        <Canvas
          frameloop={running ? "always" : "never"}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 0, 6.5], fov: 35 }}
          onCreated={() => setReady(true)}
        >
          <Orb color={centre} glow={edge} pointer={pointer} />
          {RINGS.map((props, i) => (
            // Additive glow only works on a dark page; on white it would vanish.
            <Ring key={i} {...props} color={particles} size={theme.dark ? 70 : 60} blending={theme.dark ? AdditiveBlending : NormalBlending} />
          ))}
        </Canvas>
      </CanvasBoundary>
    </div>
  );
};

export default HeroOrb;
