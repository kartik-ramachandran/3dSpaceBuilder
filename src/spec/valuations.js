/*
 * Demo market valuations for a residential development. Everything here is generated, deterministic
 * dummy data for illustration: per-apartment valuation histories, placement confidence and a
 * least-squares trend surface (rate against quarter and floor). Not market data.
 */
import { rng } from '../util.js';

export const QUARTERS = 16;          // 2022 Q1 … 2025 Q4
const FIRST_YEAR = 2022;
export const quarterLabel = (q) => `${FIRST_YEAR + Math.floor(q / 4)} Q${(q % 4) + 1}`;
const PURPOSES = ['Mortgage', 'Pre-sale', 'Refinance', 'Insurance'];
const VALUERS = ['Panel valuer A', 'Panel valuer B', 'Panel valuer C'];

/** Generates a valuation history for each apartment zone of a normalized development spec. */
export function buildValuations(spec) {
  const { basePrice, unitsPerFloor } = spec.shell;
  const base = Math.max(1, basePrice) / 64;          // example rate per m² for a 64 m² ground-floor unit
  const byZone = new Map();
  const all = [];
  for (const z of spec.zones) {
    const r = rng(z.building * 1009 + z.floor * 97 + z.unit * 13 + 7);
    const confidence = r() < 0.5 ? 'H' : r() < 0.72 ? 'M' : 'L';
    r(); // Preserve deterministic random sequence; every flat receives dummy history.
    const count = 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
    const quarters = new Set();
    while (quarters.size < count) quarters.add(Math.floor(r() * QUARTERS));
    const valuations = [...quarters].sort((a, b) => a - b).map((q) => {
      const time = 1 + 0.011 * q + 0.00035 * q * q;
      const floor = z.tower ? 1.12 + 0.008 * (z.floor - 1) : 1 + 0.028 * (z.floor - 1) - 0.0018 * (z.floor - 1) ** 2;
      const building = 1 + (((z.building * 37) % 7) - 3) * 0.012;
      const corner = z.unit === 1 || z.unit === unitsPerFloor ? 1.03 : 1;
      const size = z.bedrooms >= 2 ? 0.98 : 1;
      const noise = 1 + (r() + r() + r() - 1.5) * 0.06;
      const rate = Math.round(base * time * floor * building * corner * size * noise / 10) * 10;
      const v = { zone: z.id, q, quarter: quarterLabel(q), floor: z.floor, building: z.building, rate,
        value: Math.round(rate * z.area / 1000) * 1000, purpose: PURPOSES[Math.floor(r() * PURPOSES.length)], valuer: VALUERS[Math.floor(r() * VALUERS.length)] };
      all.push(v);
      return v;
    });
    byZone.set(z.id, { valuations, latest: valuations[valuations.length - 1], confidence });
  }
  const latestRates = [...byZone.values()].filter((e) => e.latest).map((e) => e.latest.rate);
  return {
    byZone, all,
    min: latestRates.length ? Math.min(...latestRates) : 0,
    max: latestRates.length ? Math.max(...latestRates) : 1,
    valuedCount: latestRates.length,
  };
}

/*
 * Degree-2 polynomial in quarter (q) and floor (f), fitted by least squares:
 *   rate ≈ c0 + c1·q + c2·f + c3·q² + c4·q·f + c5·f²
 * Returns null when there are too few points to fit six terms.
 */
export function fitTrend(points) {
  if (points.length < 8) return null;
  const terms = (q, f) => [1, q, f, q * q, q * f, f * f];
  const n = 6, A = Array.from({ length: n }, () => new Array(n).fill(0)), b = new Array(n).fill(0);
  for (const p of points) {
    const t = terms(p.q, p.floor);
    for (let i = 0; i < n; i++) { b[i] += t[i] * p.rate; for (let j = 0; j < n; j++) A[i][j] += t[i] * t[j]; }
  }
  for (let i = 0; i < n; i++) A[i][i] += 1e-6;       // tiny ridge keeps a single-floor dataset solvable
  const c = solve(A, b);
  if (!c) return null;
  const predict = (q, f) => terms(q, f).reduce((s, t, i) => s + t * c[i], 0);
  const mean = points.reduce((s, p) => s + p.rate, 0) / points.length;
  let ssRes = 0, ssTot = 0;
  for (const p of points) { ssRes += (p.rate - predict(p.q, p.floor)) ** 2; ssTot += (p.rate - mean) ** 2; }
  return { coef: c, predict, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, n: points.length };
}

function solve(A, b) {                                // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const k = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= k * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
