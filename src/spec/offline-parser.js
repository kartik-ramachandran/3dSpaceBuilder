/*
 * Keyword parser used when Claude isn't available in the current view.
 * Starts from a preset and adjusts it from words in the prompt. Prices are illustrative.
 */
import { sum } from '../util.js';
import { PRESETS } from './schema.js';

const FX = { NZD: 1, AUD: 0.91, USD: 0.59, GBP: 0.46, EUR: 0.54, SGD: 0.78, AED: 2.17, INR: 50, JPY: 90 };
export function offlineSpec(prompt) {
  const raw = String(prompt || '');
  const p = raw.toLowerCase();
  const kind = /\b(residential|apartments?|condos?|condominiums?|housing|development|developer|townships?)\b/.test(p) && !/\b(plane|jet|aircraft|airline|a380|first class)\b/.test(p) ? 'development'
    : /\b(stadium|stadia|arena|cricket|football|soccer|rugby)\b/.test(p) ? 'stadium'
    : /\b(hotel|resort|motel|inn|lodge|penthouse|guest ?rooms?)\b/.test(p) ? 'hotel'
    : /\b(office|co-?work\w*|workspace|desks?|hq|headquarters|campus)\b/.test(p) ? 'office' : 'plane';
  const spec = JSON.parse(JSON.stringify(PRESETS[kind]));
  let currency = 'NZD';
  const cm = p.match(/\b(nzd|aud|usd|gbp|eur|sgd|aed|inr|jpy)\b/);
  if (cm) currency = cm[1].toUpperCase();
  else if (/₹|rupee|india|bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|pune/.test(p)) currency = 'INR';
  else if (/dubai|abu dhabi|uae|dirham/.test(p)) currency = 'AED';
  else if (/£|london|\buk\b/.test(p)) currency = 'GBP';
  else if (/€|paris|berlin|europe/.test(p)) currency = 'EUR';
  else if (/sydney|melbourne|brisbane|australia/.test(p)) currency = 'AUD';
  else if (/\$|new york|usa|san francisco|los angeles/.test(p) && !/auckland|nz|new zealand|queenstown|wellington/.test(p)) currency = 'USD';
  const fx = FX[currency] || 1;
  const q = raw.match(/["“']([^"”']{3,36})["”']/);
  const intOf = (re) => { const m = p.match(re); return m ? parseInt(m[1], 10) : null; };

  if (kind === 'development') {
    spec.name = q ? q[1] : spec.name;
    spec.shell.buildings = intOf(/(\d+)\s*(?:apartment\s+)?(?:buildings?|blocks?|towers?)/) || 6;
    spec.shell.rows = intOf(/(\d+)\s*rows?/) || 2;
    spec.shell.floors = intOf(/(\d+)\s*(?:floors?|storeys?|stories|levels?)/) || 4;
    spec.shell.unitsPerFloor = intOf(/(\d+)\s*(?:apartments?|units?)\s*(?:per|on each|on every)\s*floor/) || 4;
    const base = p.match(/(?:base(?:\s+(?:price|value))?|starting(?:\s+(?:at|from))?|from)\s*(?:nzd|aud|usd|inr|aed|gbp|eur|\$|₹|£)?\s*([\d,]+(?:\.\d+)?)\s*(million|lakh|crore|k|m)?\b/);
    spec.shell.basePrice = base ? Math.round(Number(base[1].replaceAll(',', '')) * ({ million: 1e6, lakh: 1e5, crore: 1e7, k: 1e3, m: 1e6 }[base[2]] || 1)) : Math.round(650000 * fx);
  }

  if (kind === 'stadium') {
    const sport = /rugby/.test(p) ? 'rugby' : /football|soccer/.test(p) ? 'football' : 'cricket';
    spec.shell.sport = sport;
    spec.shell.tiers = intOf(/(\d)\s*(?:tiers?|decks?)/) || 2;
    spec.shell.roof = !/no roof|uncovered|open stands/.test(p);
    spec.shell.setting = /city|urban|downtown/.test(p) ? 'city' : 'park';
    spec.name = q ? q[1] : { cricket: 'Boundary Park', football: 'City Football Arena', rugby: 'Riverside Rugby Ground' }[sport];
    const capacity = p.match(/([\d,]+)\s*(?:seats|spectators|fans|capacity)/);
    if (capacity) {
      const total = Math.max(1000, Math.min(100000, Number(capacity[1].replaceAll(',', ''))));
      const weights = [0.4, 0.3, 0.25, 0.05]; let assigned = 0;
      spec.zones.forEach((z, i) => { z.capacity = i === spec.zones.length - 1 ? total - assigned : Math.round(total * weights[i]); assigned += z.capacity; });
    }
  }

  if (kind === 'plane') {
    const narrow = /regional|domestic|short|narrow|a320|a321|737|queenstown|wellington|christchurch/.test(p);
    const wanted = ['residence', 'first', 'business', 'bar', 'premium', 'economy'].filter((t) => p.includes(t === 'bar' ? 'bar' : t === 'premium' ? 'premium' : t));
    if (narrow) {
      spec.shell = { engines: 2, route: '', livery: '#1e4e79' };
      spec.zones = [
        { name: 'Business', type: 'business', capacity: 12, layout: '2-2', price: 690, features: ['Extra legroom', 'Lounge access'] },
        { name: 'Economy', type: 'economy', capacity: 150, layout: '3-3', price: 189, features: ['Snack and drink', 'Carry-on included'] },
      ];
      const b = intOf(/(\d{1,3})\s*business/); if (b) spec.zones[0].capacity = b;
      const e = intOf(/(\d{2,3})\s*economy/); if (e) spec.zones[1].capacity = e;
    } else if (wanted.length) {
      spec.zones = spec.zones.filter((z) => wanted.includes(z.type) || z.type === 'economy');
    }
    if (/\b4 engines?|four engines?|a380|747\b/.test(p)) spec.shell.engines = 4;
    else if (/\b2 engines?|twin|787|a350|777/.test(p) || narrow) spec.shell.engines = 2;
    const seats = intOf(/(\d{2,3})\s*(?:seats|passengers|pax)/);
    if (seats) { const eco = spec.zones.find((z) => z.type === 'economy'); const others = sum(spec.zones.filter((z) => z !== eco).map((z) => z.capacity)); eco.capacity = Math.max(30, seats - others); }
    const rt = raw.match(/\b([A-Z]{3})\s*(?:→|->|–|-|to)\s*([A-Z]{3})\b/);
    const ft = raw.match(/from\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\s+to\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
    spec.shell.route = rt ? `${rt[1]} → ${rt[2]}` : ft ? `${ft[1]} → ${ft[2]}` : (narrow ? 'Domestic' : spec.shell.route);
    spec.name = q ? q[1] : narrow ? 'Coastline 321' : spec.name;
  }
  if (kind === 'hotel') {
    const floors = intOf(/(\d{1,2})\s*(?:floors?|storeys?|stories|levels?)/);
    spec.shell.setting = /beach|resort|sea|ocean|dubai|bali|maldives/.test(p) ? 'beach' : /mountain|alpine|ski|queenstown/.test(p) ? 'mountain' : /harbour|harbor|waterfront|wharf|viaduct|marina/.test(p) ? 'harbour' : 'city';
    spec.shell.amenities = ['rooftop pool', 'helipad', 'sky bar', 'garden'].filter((a) => p.includes(a.split(' ').pop()));
    if (!spec.shell.amenities.length && /pool/.test(p)) spec.shell.amenities = ['rooftop pool'];
    if (/sky bar|rooftop bar/.test(p)) spec.zones.splice(spec.zones.length - 1, 0, { name: 'Sky Bar', type: 'amenity', capacity: 120, floors: 1, price: 0, features: ['Cocktails', 'Open late'] });
    if (/family/.test(p)) spec.zones.splice(2, 0, { name: 'Family Suite', type: 'suite', capacity: 24, floors: 3, price: 640, features: ['Two bedrooms', 'Kids club'] });
    if (/sea|ocean|beach/.test(p)) spec.zones[1].name = 'Sea View King';
    if (floors) {
      const fixed = sum(spec.zones.filter((z) => z.type !== 'room').map((z) => z.floors));
      const rooms = spec.zones.filter((z) => z.type === 'room');
      const left = Math.max(rooms.length, floors - 1 - fixed);
      rooms.forEach((z, i) => { z.floors = Math.max(1, Math.round(left / rooms.length) + (i === 0 ? left % rooms.length : 0)); z.capacity = z.floors * 16; });
    }
    if (/royal/.test(p)) spec.zones.find((z) => z.type === 'penthouse').name = 'Royal Penthouse';
    spec.name = q ? q[1] : spec.shell.setting === 'beach' ? 'Shoreline Resort' : spec.shell.setting === 'mountain' ? 'Ridgeline Lodge' : spec.shell.setting === 'city' ? 'Meridian Tower' : spec.name;
  }
  if (kind === 'office') {
    const floors = intOf(/(\d{1,2})\s*(?:floors?|storeys?|stories|levels?)/);
    if (floors) spec.shell.floors = floors;
    spec.shell.setting = /park|garden|green/.test(p) ? 'park' : /waterfront|harbour|harbor|wharf|sea/.test(p) ? 'waterfront' : /tech|city|cbd|downtown|bengaluru|bangalore|mumbai/.test(p) ? 'city' : 'waterfront';
    const desks = intOf(/(\d{2,4})\s*(?:desks|people|staff|seats|employees)/);
    if (/tech|hq|headquarters|campus/.test(p)) {
      spec.zones = [
        { name: 'Cafeteria', type: 'lounge', capacity: 120, price: 0, features: ['Hot meals', 'Coffee bar'] },
        { name: 'Open Desks', type: 'desks', capacity: desks || 320, price: 520, priceUnit: '/desk/mo', features: ['Sit-stand desks', 'Dual monitors'] },
        { name: 'Meeting Rooms', type: 'meeting', capacity: intOf(/(\d{1,3})\s*meeting/) || 16, price: 45, priceUnit: '/hr', features: ['Video conferencing'] },
        { name: 'Leadership Cabins', type: 'offices', capacity: 12, price: 2600, priceUnit: '/office/mo', features: ['Lockable', 'Corner glass'] },
      ];
    } else if (desks) {
      const d = spec.zones.filter((z) => z.type === 'desks');
      d[0].capacity = Math.round(desks * 0.6); d[1].capacity = Math.round(desks * 0.4);
    }
    spec.name = q ? q[1] : spec.shell.setting === 'city' ? 'Northgate Tech Park' : spec.shell.setting === 'park' ? 'Parkside Studios' : spec.name;
  }
  spec.currency = currency;
  if (fx !== 1) spec.zones.forEach((z) => { z.price = Math.round(z.price * fx / (fx > 20 ? 100 : fx > 2 ? 10 : 1)) * (fx > 20 ? 100 : fx > 2 ? 10 : 1); });
  spec.subtitle = '';
  return spec;
}
