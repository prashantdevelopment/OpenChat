// Helpers for the map of India on Discover (see components/IndiaMap.jsx).
// The map itself is data/india-map.json: official Survey of India state
// boundaries, simplified and projected once (its "source" field says how).

// Colour strength (0..1) for an online count. null (fewer than 5, hidden by
// the server) and 0 look the same. Logarithmic, so one busy state doesn't
// wash out all the others; 500 or more is the full colour.
export const mapLevel = (online) => (online ? Math.min(1, Math.log10(online) / Math.log10(500)) : 0);

// The fill for a state: the paper colour, mixed with more of the brand red
// the more people are online there.
export const stateFill = (online) => {
  const level = mapLevel(online);
  return level === 0 ? "var(--map-land)" : `color-mix(in oklab, var(--brand) ${Math.round(22 + level * 78)}%, var(--map-land))`;
};

// Where the popup for a state goes, in % of the map: next to the state, on
// the side with more room (states in the east open it to their left).
export const popupPlacement = ({ cx, cy }, { width, height }) => ({
  x: (cx / width) * 100,
  y: (cy / height) * 100,
  side: cx / width > 0.55 ? "left" : "right",
});
