// A tile map of India: every state and union territory is one hexagon, placed
// roughly where it is (north at the top, islands to the sides). It shows no
// borders on purpose: it is a picture of the states, not a map of India's
// boundaries. Rows of pointy-top hexagons; odd rows are shifted half a tile.
// [code, short label, row, column]
export const INDIA_TILES = [
  ["jammu-and-kashmir", "JK", 0, 2],
  ["ladakh", "LA", 0, 3],
  ["punjab", "PB", 1, 1],
  ["himachal-pradesh", "HP", 1, 2],
  ["uttarakhand", "UK", 1, 3],
  ["chandigarh", "CH", 2, 1],
  ["haryana", "HR", 2, 2],
  ["delhi", "DL", 2, 3],
  ["uttar-pradesh", "UP", 2, 4],
  ["bihar", "BR", 2, 5],
  ["sikkim", "SK", 2, 6],
  ["arunachal-pradesh", "AR", 2, 8],
  ["rajasthan", "RJ", 3, 1],
  ["madhya-pradesh", "MP", 3, 2],
  ["jharkhand", "JH", 3, 4],
  ["west-bengal", "WB", 3, 5],
  ["meghalaya", "ML", 3, 6],
  ["assam", "AS", 3, 7],
  ["nagaland", "NL", 3, 8],
  ["gujarat", "GJ", 4, 1],
  ["dadra-nagar-haveli-daman-diu", "DD", 4, 2],
  ["maharashtra", "MH", 4, 3],
  ["chhattisgarh", "CG", 4, 4],
  ["odisha", "OD", 4, 5],
  ["tripura", "TR", 4, 7],
  ["manipur", "MN", 4, 8],
  ["goa", "GA", 5, 2],
  ["telangana", "TG", 5, 3],
  ["andhra-pradesh", "AP", 5, 4],
  ["mizoram", "MZ", 5, 7],
  ["lakshadweep", "LD", 6, 0],
  ["karnataka", "KA", 6, 2],
  ["tamil-nadu", "TN", 6, 3],
  ["puducherry", "PY", 6, 4],
  ["andaman-and-nicobar-islands", "AN", 6, 7],
  ["kerala", "KL", 7, 2],
].map(([code, label, row, column]) => ({ code, label, row, column }));

const SQRT3 = Math.sqrt(3);

// Centre of each tile on the ground (x to the east, z to the south), with
// the whole map centred on 0,0. radius: the hexagon's corner distance.
export const tilePositions = (radius = 1) => {
  const raw = INDIA_TILES.map((tile) => ({
    ...tile,
    x: (tile.column + (tile.row % 2 ? 0.5 : 0)) * SQRT3 * radius,
    z: tile.row * 1.5 * radius,
  }));
  const midX = (Math.min(...raw.map((t) => t.x)) + Math.max(...raw.map((t) => t.x))) / 2;
  const midZ = (Math.min(...raw.map((t) => t.z)) + Math.max(...raw.map((t) => t.z))) / 2;
  return raw.map((tile) => ({ ...tile, x: tile.x - midX, z: tile.z - midZ }));
};

// Tile height and colour strength (0..1) for an online count; null (fewer
// than 5, hidden by the server) looks like 0. Logarithmic, so one busy state
// doesn't flatten all the others.
export const tileLevel = (online) => (online ? Math.min(1, Math.log10(online) / Math.log10(500)) : 0);
