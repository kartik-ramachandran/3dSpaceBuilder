/*
 * Geometry of a residential development site, shared by the 3D scene and the valuation model,
 * so "where an apartment is" means the same thing in both. Plain numbers, no Three.js.
 * Axes: x across the site (west → east), z from the back (−z, south, motorway side) to the front
 * (+z, north: balconies, river and the sun, for a southern-hemisphere site).
 */
export const DEV = { UW: 7.5, D: 11, FH: 3.2, BASE: 0.6, GAP_X: 16, GAP_Z: 26, BALCONY: 1.6 };

export function developmentLayout({ buildings, rows, floors, unitsPerFloor }) {
  const { UW, D, FH, BASE, GAP_X, GAP_Z } = DEV;
  const cols = Math.ceil(buildings / rows);
  const BX = unitsPerFloor * UW;
  const siteX = cols * BX + (cols - 1) * GAP_X, siteZ = rows * D + (rows - 1) * GAP_Z;
  const towerWidth = Math.min(26, BX), towerDepth = rows > 1 ? 14 : 6;
  const towerZ = rows > 1 ? siteZ / 2 - D - GAP_Z / 2 : siteZ / 2 + 10;
  // Building origins: row 0 at the front (+z), columns left to right; letters run A, B, C… in that order.
  const origin = (b) => {
    if (b > buildings) return { x: -siteX / 2 + BX / 2 + (b - buildings - 1) * (BX + GAP_X), z: towerZ, row: rows > 1 ? 0.5 : 0, tower: true };
    const i = b - 1, row = Math.floor(i / cols), col = i % cols;
    const inRow = Math.min(cols, buildings - row * cols);      // centre a short last row
    const rowW = inRow * BX + (inRow - 1) * GAP_X;
    return { x: -rowW / 2 + BX / 2 + col * (BX + GAP_X), z: siteZ / 2 - D / 2 - row * (D + GAP_Z), row, col };
  };
  /** Centre of one apartment in plan. */
  const unitAt = (z) => { const o = origin(z.building); return { x: o.x - (o.tower ? towerWidth : BX) / 2 + (z.unit - 0.5) * (o.tower ? towerWidth / unitsPerFloor : UW), z: o.z, row: o.row }; };
  return { buildings, cols, rows, floors, towerWidth, towerDepth, towerZ, totalBuildings: buildings + cols, maxFloors: 100, BX, siteX, siteZ, H: BASE + floors * FH, origin, unitAt };
}
