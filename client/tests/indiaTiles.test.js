import { describe, it, expect } from "vitest";
import { INDIA_TILES, tileLevel, tilePositions } from "../src/lib/indiaTiles.js";
import { INDIAN_STATE_CODES } from "../../shared/indian-states.js";

describe("India tile map layout", () => {
  it("has one tile for each of the 36 states and union territories", () => {
    expect(INDIA_TILES.map((t) => t.code).sort()).toEqual([...INDIAN_STATE_CODES].sort());
  });

  it("never puts two tiles in the same place, and labels are unique", () => {
    const places = INDIA_TILES.map((t) => `${t.row},${t.column}`);
    expect(new Set(places).size).toBe(36);
    expect(new Set(INDIA_TILES.map((t) => t.label)).size).toBe(36);
  });

  it("puts the north at the top and Kerala at the bottom", () => {
    const z = Object.fromEntries(tilePositions().map((t) => [t.code, t.z]));
    expect(z["jammu-and-kashmir"]).toBeLessThan(z["delhi"]);
    expect(z["delhi"]).toBeLessThan(z["kerala"]);
  });

  it("keeps neighbouring tiles apart (no overlap) and centres the map", () => {
    const tiles = tilePositions(1);
    for (const a of tiles) {
      for (const b of tiles) {
        if (a === b) continue;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(Math.sqrt(3) - 1e-9);
      }
    }
    const xs = tiles.map((t) => t.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
  });

  it("maps online counts to 0..1 on a log scale; hidden counts are 0", () => {
    expect(tileLevel(null)).toBe(0);
    expect(tileLevel(0)).toBe(0);
    expect(tileLevel(5)).toBeGreaterThan(0.2);
    expect(tileLevel(50)).toBeGreaterThan(tileLevel(5));
    expect(tileLevel(100000)).toBe(1);
  });
});
