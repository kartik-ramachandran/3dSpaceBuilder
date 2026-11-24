// Deterministic concept inventory. Values are examples, never market appraisals.
const integer = (v, fallback, min, max) => Number.isFinite(Number(v)) && v !== null
  ? Math.max(min, Math.min(max, Math.round(Number(v)))) : fallback;
export function normalizeDevelopment(s, colors) {
  const raw = s.shell || {};
  const shell = {
    buildings: integer(raw.buildings, 6, 1, 8), rows: integer(raw.rows, 2, 1, 4),
    floors: integer(raw.floors, 4, 1, 8), unitsPerFloor: integer(raw.unitsPerFloor, 4, 2, 6),
    basePrice: integer(raw.basePrice, 650000, 0, 1000000000), setting: 'park',
  };
  shell.rows = Math.min(shell.rows, shell.buildings);
  const overrides = new Map();
  for (const z of Array.isArray(s.zones) ? s.zones : []) {
    if (z && typeof z === 'object') overrides.set(`${z.building}-${z.floor}-${z.unit}`, z);
  }
  const zones = [];
  const towerCount = Math.ceil(shell.buildings / shell.rows);
  for (let b = 1; b <= shell.buildings + towerCount; b++) for (let f = 1; f <= (b > shell.buildings ? 100 : shell.floors); f++) for (let u = 1; u <= shell.unitsPerFloor; u++) {
    const z = overrides.get(`${b}-${f}-${u}`) || {};
    const letter = String.fromCharCode(64 + b), number = `${f}${String(u).padStart(2, '0')}`;
    const bedrooms = integer(z.bedrooms, u % 2 ? 1 : 2, 1, 4);
    const area = integer(z.area, u % 2 ? 64 : 80, 25, 400);
    const tower = b > shell.buildings;
    const example = Math.round(shell.basePrice * (area / 64) * (1 + (f - 1) * (tower ? 0.008 : 0.035) + (b - 1) * 0.018 + (u - 1) * 0.003) / 1000) * 1000;
    const supplied = z.price !== undefined && Number.isFinite(Number(z.price));
    const price = integer(z.price, example, 0, 1000000000);
    const valueSource = supplied && z.valueSource !== 'illustrative' ? 'provided' : 'illustrative';
    zones.push({ id: `apartment-${letter.toLowerCase()}-${number}`, type: 'apartment', name: `${letter} · ${number}`,
      building: b, tower, floor: f, unit: u, bedrooms, area, capacity: 1, price, valueSource,
      priceUnit: valueSource === 'provided' ? 'provided value' : 'example value',
      color: colors[(b - 1) % colors.length],
      features: [`${bedrooms} bedroom${bedrooms > 1 ? 's' : ''}`, `${area} m² interior`, 'Private balcony'],
      blurb: `Building ${letter}, level ${f}. ${valueSource === 'provided' ? 'Value supplied in the project brief.' : 'Illustrative concept value based on apartment size, floor and building; not a market appraisal.'}`,
    });
  }
  return { kind: 'development', name: String(s.name || 'Parkside Residences').slice(0, 40),
    subtitle: String(s.subtitle || '').slice(0, 70), currency: /^[A-Z]{3}$/.test(s.currency || '') ? s.currency : 'NZD',
    shell, zones, design: Object.fromEntries(['woodColor', 'upholsteryColor', 'floorColor', 'wallColor']
      .filter(k => /^#[0-9a-f]{6}$/i.test(s.design?.[k] || '')).map(k => [k, s.design[k]])) };
}
