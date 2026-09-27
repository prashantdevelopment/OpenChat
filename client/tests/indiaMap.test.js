import { describe, it, expect } from "vitest";
import MAP from "../src/data/india-map.json";
import { mapLevel, popupPlacement, stateFill } from "../src/lib/indiaMap.js";
import { INDIAN_STATE_CODES } from "../../shared/indian-states.js";

describe("map of India data", () => {
  it("has every state and union territory exactly once", () => {
    expect(MAP.states.map((s) => s.code).sort()).toEqual([...INDIAN_STATE_CODES].sort());
  });

  it("says where it comes from (Survey of India)", () => {
    expect(MAP.source).toMatch(/Survey of India/);
  });

  it("keeps the official northern boundary: Ladakh reaches the top of the map", () => {
    const ladakh = MAP.states.find((s) => s.code === "ladakh");
    const top = Math.min(...ladakh.d.match(/-?\d+\.?\d*/g).filter((_, i) => i % 2 === 1).map(Number));
    expect(top).toBeLessThan(5); // the northernmost point of the whole map
  });

  it("puts north at the top and Kerala in the south", () => {
    const y = Object.fromEntries(MAP.states.map((s) => [s.code, s.cy]));
    expect(y["jammu-and-kashmir"]).toBeLessThan(y.delhi);
    expect(y.delhi).toBeLessThan(y.kerala);
  });
});

describe("map colours and popup", () => {
  it("maps online counts to 0..1 on a log scale; hidden counts are 0", () => {
    expect(mapLevel(null)).toBe(0);
    expect(mapLevel(0)).toBe(0);
    expect(mapLevel(5)).toBeGreaterThan(0.2);
    expect(mapLevel(50)).toBeGreaterThan(mapLevel(5));
    expect(mapLevel(100000)).toBe(1);
  });

  it("paints hidden counts as plain land, busy states with more red", () => {
    expect(stateFill(null)).toBe("var(--map-land)");
    const percent = (fill) => Number(fill.match(/(\d+)%/)[1]);
    expect(percent(stateFill(200))).toBeGreaterThan(percent(stateFill(6)));
  });

  it("opens the popup on the side with room", () => {
    expect(popupPlacement({ cx: 235, cy: 911 }, MAP).side).toBe("right"); // Kerala
    expect(popupPlacement({ cx: 840, cy: 300 }, MAP).side).toBe("left"); // Arunachal Pradesh
  });
});
