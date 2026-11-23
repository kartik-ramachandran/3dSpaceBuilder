/*
 * Layout spec: the JSON contract between the prompt step (Claude or the offline parser)
 * and the 3D renderer. normalize() clamps and fills every field so a partial reply still renders.
 */
import { clamp, sum, slug } from '../util.js';
import { normalizeDevelopment } from './development.js';

export const TYPES = {
  development: ['apartment'],
  plane: ['residence', 'first', 'business', 'bar', 'premium', 'economy'],
  hotel: ['room', 'suite', 'penthouse', 'amenity'],
  office: ['desks', 'offices', 'meeting', 'lounge', 'event'],
  stadium: ['general', 'supporters', 'club', 'vip'],
};
export const TYPE_LABEL = {
  apartment: 'Apartment',
  residence: 'Residence', first: 'First', business: 'Business', bar: 'Lounge', premium: 'Premium economy', economy: 'Economy',
  room: 'Rooms', suite: 'Suites', penthouse: 'Penthouse', amenity: 'Amenity',
  desks: 'Desks', offices: 'Private offices', meeting: 'Meeting rooms', lounge: 'Lounge', event: 'Event space',
  general: 'Grandstand', supporters: 'Supporters', club: 'Club seating', vip: 'Hospitality',
};
export const PALETTE = ['#ffc477', '#ff8f7d', '#7fd6c2', '#ab9dff', '#7fb6ff', '#d9e47a', '#ff9fd0'];
export const PLANE_PITCH = { residence: 5.6, first: 2.5, business: 1.95, bar: 4.4, premium: 0.98, economy: 0.81 };
export const PLANE_LAYOUT = { residence: [1], first: [1, 1, 1], business: [1, 2, 1], bar: [1], premium: [2, 4, 2], economy: [3, 4, 3] };
export const HOTEL_PER_FLOOR = { room: 16, suite: 8, penthouse: 2, amenity: 1 };
export const OFFICE_PER_BAY = { desks: 16, offices: 4, meeting: 2, lounge: 30, event: 60 };

export const PRESETS = {
  development: { kind: 'development', name: 'Parkside Residences', currency: 'NZD',
    shell: { buildings: 6, rows: 2, floors: 4, unitsPerFloor: 4, basePrice: 650000 }, zones: [] },
  stadium: {
    kind: 'stadium', name: 'Boundary Park', subtitle: '', currency: 'NZD',
    shell: { sport: 'cricket', tiers: 2, roof: true, setting: 'park' },
    zones: [
      { name: 'East Grandstand', type: 'general', capacity: 8000, price: 45, priceUnit: '/match', features: ['Reserved seating', 'Full field view'], blurb: 'Tiered seating overlooking the playing field.' },
      { name: 'South Supporters', type: 'supporters', capacity: 6000, price: 35, priceUnit: '/match', features: ['Supporters section', 'Food concourse'], blurb: 'A lively end stand close to the action.' },
      { name: 'West Club Stand', type: 'club', capacity: 5000, price: 110, priceUnit: '/match', features: ['Padded seats', 'Club lounge'], blurb: 'An elevated view with access to the club concourse.' },
      { name: 'North Pavilion', type: 'vip', capacity: 1000, price: 260, priceUnit: '/match', features: ['Hospitality seating', 'Premium sightlines'], blurb: 'Premium pavilion seating looking back across the field.' },
    ],
  },
  plane: {
    kind: 'plane', name: 'Long-haul Jet', subtitle: '', currency: 'NZD',
    shell: { engines: 4, route: 'AKL → DXB', livery: '#1e4e79' },
    zones: [
      { name: 'The Residence', type: 'residence', capacity: 1, price: 38500, priceUnit: 'one-way', features: ['Living room', 'Double bedroom', 'En-suite shower'], blurb: 'A three-room apartment for two, behind its own door.' },
      { name: 'First Apartment', type: 'first', capacity: 9, layout: '1-1-1', price: 16900, priceUnit: 'one-way', features: ['Sliding door', 'Separate bed', 'Vanity unit'], blurb: 'Private suites with a lounge chair and a separate bed.' },
      { name: 'Business Studio', type: 'business', capacity: 36, layout: '1-2-1', price: 8400, priceUnit: 'one-way', features: ['Lie-flat bed', 'Direct aisle access', '24-inch screen'], blurb: 'Every seat opens onto the aisle and folds into a 2 m bed.' },
      { name: 'Onboard Lounge', type: 'bar', capacity: 12, price: 0, priceUnit: 'included', features: ['Bar', 'Sofa seating'], blurb: 'Open to First and Business guests for the whole flight.' },
      { name: 'Premium Economy', type: 'premium', capacity: 40, layout: '2-4-2', price: 3900, priceUnit: 'one-way', features: ['38-inch pitch', 'Leg rest', 'Priority boarding'], blurb: 'A wider seat and more legroom in a quieter cabin.' },
      { name: 'Economy', type: 'economy', capacity: 200, layout: '3-4-3', price: 1490, priceUnit: 'one-way', features: ['31-inch pitch', 'USB-C power', 'Two meals'], blurb: 'Seat-back screens and two hot meals on the 17-hour sector.' },
    ],
  },
  hotel: {
    kind: 'hotel', name: 'Harbourline Hotel', subtitle: '', currency: 'NZD',
    shell: { setting: 'harbour', amenities: ['rooftop pool'] },
    zones: [
      { name: 'City Queen', type: 'room', capacity: 96, floors: 6, price: 289, priceUnit: '/night', features: ['Queen bed', 'Rain shower', 'City outlook'], blurb: 'Compact rooms on the lower floors, facing the harbour or the city.' },
      { name: 'Harbour King', type: 'room', capacity: 96, floors: 6, price: 419, priceUnit: '/night', features: ['King bed', 'Window seat', 'Harbour view'], blurb: 'Mid-tower rooms with a window seat over the water.' },
      { name: 'Executive Suite', type: 'suite', capacity: 32, floors: 4, price: 790, priceUnit: '/night', features: ['Separate lounge', 'Club access', 'Soaking tub'], blurb: 'A bedroom and lounge across two bays, with club lounge access.' },
      { name: 'Penthouse', type: 'penthouse', capacity: 2, floors: 1, price: 3900, priceUnit: '/night', features: ['Wraparound glass', 'Private terrace', 'Butler'], blurb: 'Half a floor each, one level below the rooftop pool.' },
    ],
  },
  office: {
    kind: 'office', name: 'Harbourside Works', subtitle: '', currency: 'NZD',
    shell: { floors: 4, setting: 'waterfront', amenities: ['rooftop terrace'] },
    zones: [
      { name: 'Café & Lounge', type: 'lounge', capacity: 60, price: 0, priceUnit: 'included', features: ['Barista coffee', 'Booths'], blurb: 'Ground-floor café open to every member.' },
      { name: 'Event Space', type: 'event', capacity: 120, price: 1500, priceUnit: '/day', features: ['Stage', 'AV kit', '120 seats'], blurb: 'Theatre-style hall that turns into a networking floor.' },
      { name: 'Hot Desk', type: 'desks', capacity: 96, price: 450, priceUnit: '/desk/mo', features: ['Any free desk', 'Lockers'], blurb: 'Turn up and take any free desk on level 2.' },
      { name: 'Dedicated Desk', type: 'desks', capacity: 64, price: 690, priceUnit: '/desk/mo', features: ['Your own desk', 'Monitor', '24/7 access'], blurb: 'A desk that stays set up the way you left it.' },
      { name: 'Meeting Rooms', type: 'meeting', capacity: 8, price: 60, priceUnit: '/hr', features: ['Screens', 'Whiteboards'], blurb: 'Bookable glass rooms for 6 to 14 people.' },
      { name: 'Private Office', type: 'offices', capacity: 12, price: 3200, priceUnit: '/office/mo', features: ['4 desks', 'Lockable', 'Top floor'], blurb: 'Lockable glass offices for teams of four on the top level.' },
    ],
  },
};

function guessType(kind, name) {
  const n = String(name || '').toLowerCase();
  if (kind === 'stadium') return /vip|hospital|pavilion|box/.test(n) ? 'vip' : /club|premium/.test(n) ? 'club' : /support|fan/.test(n) ? 'supporters' : 'general';
  if (kind === 'plane') {
    if (/resid|apartment|villa/.test(n)) return 'residence';
    if (/first/.test(n)) return 'first';
    if (/business|club|upper/.test(n)) return 'business';
    if (/bar|lounge/.test(n)) return 'bar';
    if (/premium|plus|comfort/.test(n)) return 'premium';
    return 'economy';
  }
  if (kind === 'hotel') {
    if (/penthouse|royal|presidential/.test(n)) return 'penthouse';
    if (/suite/.test(n)) return 'suite';
    if (/bar|spa|pool|gym|restaurant|club lounge/.test(n)) return 'amenity';
    return 'room';
  }
  if (/office|cabin|suite/.test(n)) return 'offices';
  if (/meet|board|conference/.test(n)) return 'meeting';
  if (/caf|lounge|kitchen|cafeteria/.test(n)) return 'lounge';
  if (/event|hall|auditorium/.test(n)) return 'event';
  return 'desks';
}
function defaultUnit(kind, type) {
  if (kind === 'plane') return 'one-way';
  if (kind === 'hotel') return '/night';
  if (kind === 'stadium') return '/match';
  return { desks: '/desk/mo', offices: '/office/mo', meeting: '/hr', lounge: 'included', event: '/day' }[type];
}
function parseLayout(s, type) {
  const groups = String(s || '').split(/[^0-9]+/).filter(Boolean).map(Number).filter((n) => n > 0 && n <= 5);
  if (!groups.length || groups.length > 4 || sum(groups) > 10) return PLANE_LAYOUT[type].slice();
  if (type === 'residence' || type === 'bar') return [1];
  return groups;
}
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  let kind = String(s.kind || '').toLowerCase();
  if (kind === 'development') return normalizeDevelopment(s, PALETTE);
  if (!TYPES[kind]) kind = 'plane';
  const cur = String(s.currency || '').toUpperCase();
  const currency = /^[A-Z]{3}$/.test(cur) ? cur : 'NZD';
  const shell = s.shell && typeof s.shell === 'object' ? { ...s.shell } : {};
  let zones = (Array.isArray(s.zones) ? s.zones : []).filter((z) => z && typeof z === 'object').slice(0, 7);
  if (!zones.length) return normalize({ ...PRESETS[kind], ...s, kind, zones: PRESETS[kind].zones });
  const seen = new Set();
  zones = zones.map((z, i) => {
    const t = String(z.type || '').toLowerCase();
    const type = TYPES[kind].includes(t) ? t : guessType(kind, z.name);
    let id = slug(z.id || z.name || type);
    while (seen.has(id)) id += '-' + i;
    seen.add(id);
    const capMax = kind === 'stadium' ? 100000 : kind === 'plane' ? (type === 'residence' ? 3 : 520) : kind === 'hotel' ? 1200 : 1500;
    const price = Math.max(0, Math.round(num(z.price, 0)));
    return {
      id, type,
      name: String(z.name || TYPE_LABEL[type]).slice(0, 36),
      capacity: clamp(Math.round(num(z.capacity, type === 'residence' ? 1 : 24)), 1, capMax),
      price,
      priceUnit: price === 0 ? 'included' : String(z.priceUnit || defaultUnit(kind, type)).slice(0, 14),
      layout: kind === 'plane' ? parseLayout(z.layout, type) : null,
      floors: kind === 'hotel' ? clamp(Math.round(num(z.floors, 0)), 0, 40) : 0,
      features: (Array.isArray(z.features) ? z.features : []).slice(0, 4).map((f) => String(f).slice(0, 34)),
      blurb: z.blurb ? String(z.blurb).slice(0, 140) : '',
    };
  });
  if (kind === 'plane') {
    const order = TYPES.plane;
    zones.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || b.price - a.price);
  }
  if (kind === 'hotel') {
    const order = ['room', 'amenity', 'suite', 'penthouse'];
    zones.sort((a, b) => (order.indexOf(a.type) - order.indexOf(b.type)) || (a.price - b.price));
  }
  zones.forEach((z, i) => { z.color = PALETTE[i % PALETTE.length]; });
  const out = {
    kind, currency, zones,
    name: String(s.name || PRESETS[kind].name).slice(0, 40),
    subtitle: String(s.subtitle || '').slice(0, 70),
    shell: {},
    design: Object.fromEntries(['woodColor', 'upholsteryColor', 'floorColor', 'wallColor']
      .filter((key) => /^#[0-9a-f]{6}$/i.test(s.design?.[key] || ''))
      .map((key) => [key, s.design[key]])),
  };
  if (kind === 'plane') {
    out.shell.engines = num(shell.engines, 2) >= 4 ? 4 : 2;
    out.shell.route = String(shell.route || '').slice(0, 24);
    out.shell.livery = /^#[0-9a-f]{6}$/i.test(shell.livery || '') ? shell.livery : '#1e4e79';
  } else if (kind === 'stadium') {
    const sport = String(shell.sport || '').toLowerCase();
    out.shell.sport = sport === 'soccer' ? 'football' : ['cricket', 'football', 'rugby'].includes(sport) ? sport : 'cricket';
    out.shell.tiers = clamp(Math.round(num(shell.tiers, 2)), 1, 3);
    out.shell.roof = shell.roof !== false;
    out.shell.setting = shell.setting === 'city' ? 'city' : 'park';
  } else {
    const settings = kind === 'hotel' ? ['harbour', 'city', 'beach', 'mountain'] : ['waterfront', 'city', 'park'];
    const st = String(shell.setting || '').toLowerCase();
    out.shell.setting = settings.includes(st) ? st : settings[0];
    out.shell.amenities = (Array.isArray(shell.amenities) ? shell.amenities : []).map((a) => String(a).toLowerCase()).slice(0, 5);
    if (kind === 'office') out.shell.floors = clamp(Math.round(num(shell.floors, 0)), 0, 10);
  }
  return out;
}
