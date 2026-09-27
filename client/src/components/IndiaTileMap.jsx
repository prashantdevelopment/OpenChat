import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CanvasTexture, Color, MathUtils, SRGBColorSpace, Vector3 } from "three";
import { INDIA_TILES, tileLevel, tilePositions } from "../lib/indiaTiles.js";
import { hasWebGL } from "../lib/webgl.js";
import { useThemeColors } from "../hooks/useThemeColors.js";
import CanvasBoundary from "./CanvasBoundary.jsx";
import { INDIAN_STATES } from "../../../shared/indian-states.js";

const RADIUS = 1;
const GAP = 0.9; // tiles a little smaller than their cell, so there's a gap
const tiles = tilePositions(RADIUS);
// Camera: straight above-and-south of the map, looking a little below the middle.
const CAMERA = new Vector3(0, 13, 9.5);
const TARGET = new Vector3(0, 0, 0.6);
const FOV = 40;
// Half the map's width (tile centres plus a tile and a little margin).
const HALF_WIDTH = Math.max(...tiles.map((tile) => Math.abs(tile.x))) + RADIUS * 1.3;
const stateName = (code) => INDIAN_STATES.find((state) => state.code === code)?.name ?? code;

// The short label (e.g. "KL") drawn on a small canvas, shown as a sprite.
const labelTexture = (text, colour) => {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "600 40px Poppins, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = colour;
  ctx.fillText(text, 64, 34);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
};

// One hexagonal prism: taller and bluer with more people online.
const Tile = ({ tile, online, selected, hovered, theme, texture, onSelect, onHover }) => {
  const level = tileLevel(online);
  const height = 0.25 + level * 1.6 + (selected ? 0.25 : 0) + (hovered ? 0.1 : 0);
  const colour = useMemo(() => new Color(theme.muted).lerp(new Color(theme.primary), 0.25 + level * 0.75), [theme, level]);
  return (
    <group position={[tile.x, 0, tile.z]}>
      <mesh
        position={[0, height / 2, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(tile.code);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onHover(tile.code);
        }}
        onPointerOut={() => onHover(null)}
      >
        {/* 6 sides = a hexagon, with a corner pointing north like the layout. */}
        <cylinderGeometry args={[RADIUS * GAP, RADIUS * GAP, height, 6]} />
        <meshStandardMaterial color={colour} emissive={selected ? theme.ring : "#000000"} emissiveIntensity={selected ? 0.35 : 0} roughness={0.55} />
      </mesh>
      <sprite position={[0, height + 0.35, 0]} scale={[0.9, 0.45, 1]}>
        <spriteMaterial map={texture} transparent depthWrite={false} />
      </sprite>
    </group>
  );
};

// Moves the camera back on narrow screens (phones) so every tile fits across;
// on wide screens it stays at the default distance.
const FitCamera = () => {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const halfFovX = Math.atan(Math.tan(MathUtils.degToRad(FOV / 2)) * (size.width / size.height));
    const direction = CAMERA.clone().sub(TARGET);
    const distance = Math.max(direction.length(), (HALF_WIDTH / Math.tan(halfFovX)) * 1.1); // +10%: near rows look wider
    camera.position.copy(TARGET).add(direction.setLength(distance));
    camera.lookAt(TARGET);
    invalidate();
  }, [camera, size, invalidate]);
  return null;
};

// 3D tile map of India's states and union territories (no borders: a
// picture, not a boundary map). Height and colour = people online; click a
// tile to choose the state. Renders only when something changes (frameloop
// "demand"), so it costs nothing while you read. The list next to it is the
// accessible way to choose a state; this is described as one image.
const IndiaTileMap = ({ counts, selected, onSelect }) => {
  const theme = useThemeColors();
  const [hovered, setHovered] = useState(null);
  const [webgl] = useState(hasWebGL);
  const textures = useMemo(
    () => Object.fromEntries(INDIA_TILES.map((tile) => [tile.code, labelTexture(tile.label, theme.foreground)])),
    [theme.foreground],
  );
  useEffect(() => () => Object.values(textures).forEach((texture) => texture.dispose()), [textures]);
  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  if (!webgl) return null;
  const hoveredCount = hovered ? counts[hovered] : undefined;

  return (
    <div
      role="img"
      aria-label="India's states and union territories as 3D tiles: taller and bluer means more people online. Use the list to choose a state."
      className="relative h-full w-full"
    >
      <CanvasBoundary>
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ position: CAMERA.toArray(), fov: FOV }}
          onPointerMissed={() => setHovered(null)}
        >
          <FitCamera />
          <ambientLight intensity={1.2} />
          <directionalLight position={[4, 10, 6]} intensity={1.6} />
          {tiles.map((tile) => (
            <Tile
              key={tile.code}
              tile={tile}
              online={counts[tile.code] ?? null}
              selected={tile.code === selected}
              hovered={tile.code === hovered}
              theme={theme}
              texture={textures[tile.code]}
              onSelect={onSelect}
              onHover={setHovered}
            />
          ))}
        </Canvas>
      </CanvasBoundary>
      {hovered ? (
        <p aria-hidden="true" className="pointer-events-none absolute top-2 left-2 rounded-md bg-popover px-2 py-1 text-sm text-popover-foreground shadow">
          {stateName(hovered)} · {hoveredCount === null || hoveredCount === undefined ? "fewer than 5 online" : `${hoveredCount} online`}
        </p>
      ) : null}
    </div>
  );
};

export default IndiaTileMap;
