# Layout spec

The layout spec is the JSON object Claude returns for a prompt (`src/spec/claude-prompt.js`). The offline parser produces the same shape (`src/spec/offline-parser.js`). `normalize()` in `src/spec/schema.js` validates and fills it before the renderer sees it, so a partial or malformed reply still renders.

## Shape

```json
{
  "kind": "plane",
  "name": "Long-haul Jet",
  "subtitle": "Auckland → Dubai · long-haul flagship",
  "currency": "NZD",
  "shell": { "engines": 4, "route": "AKL → DXB", "livery": "#1e4e79" },
  "zones": [
    {
      "name": "Business Studio",
      "type": "business",
      "capacity": 36,
      "layout": "1-2-1",
      "price": 8400,
      "priceUnit": "one-way",
      "features": ["Lie-flat bed", "Direct aisle access"],
      "blurb": "Every seat opens onto the aisle."
    }
  ]
}
```

## Top level

| Field | Rule in `normalize()` |
|---|---|
| `kind` | `plane`, `hotel`, `office`, `stadium` or `development`; anything else becomes `plane` |
| `name` | up to 40 characters; the preset name if missing |
| `subtitle` | up to 70 characters; generated from the zones if empty |
| `currency` | 3-letter ISO code; `NZD` if missing or invalid |
| `zones` | 1 to 7 zones; the kind's preset if there are none |
| `design` | Optional `woodColor`, `upholsteryColor`, `floorColor`, `wallColor`, each a validated `#rrggbb` color; omitted or invalid fields use the default materials |

## Shell by kind

| Kind | Fields |
|---|---|
| plane | `engines` 2 or 4 · `route` up to 24 characters · `livery` `#rrggbb` |
| hotel | `setting` harbour, city, beach or mountain · `amenities` any of rooftop pool, helipad, sky bar, garden |
| office | `floors` 0–10 (0 means sized from the zones) · `setting` waterfront, city or park · `amenities` rooftop terrace |
| stadium | `sport` cricket, football or rugby (soccer aliases football); `tiers` 1–3; `roof` boolean; `setting` city or park |
| development | `buildings` 1–8 · `rows` 1–4 (at most `buildings`) · `floors` 1–8 · `unitsPerFloor` 2–6 · `basePrice` example value of a 64 m² ground-floor apartment (default 650,000) |

## Zones

Stadium zones use `general`, `supporters`, `club` or `vip`, with capacity in spectators (up to 100,000 per zone) and ticket prices per match (`/match`). Zones occupy consecutive sections around the bowl and provide a seat view facing the playing field.

| Field | Rule |
|---|---|
| `type` | must be one of the kind's types (below); otherwise guessed from the name |
| `capacity` | whole number ≥ 1. Plane: up to 520 seats (residence: up to 3 apartments). Hotel: up to 1,200. Office: up to 1,500 |
| `price` | whole number ≥ 0. A price of 0 shows as "Included" |
| `priceUnit` | up to 14 characters; defaults per kind and type |
| `layout` | plane only: seats across in groups, such as `1-2-1` or `3-4-3`. Up to 4 groups and 10 seats; otherwise the type's default |
| `floors` | hotel only: how many floors the zone fills; otherwise worked out from capacity |
| `features` | up to 4 strings of up to 34 characters |
| `blurb` | up to 140 characters |

### Zone types and how they're drawn

| Kind | Type | Geometry | Default unit |
|---|---|---|---|
| plane | residence | enclosed apartment: lounge, bed, shower | one-way |
| plane | first | walled suite with a bed and chair | one-way |
| plane | business | lie-flat pod with a privacy wall | one-way |
| plane | bar | bar counter, stools, window bench | included |
| plane | premium / economy | seat rows at 0.98 m / 0.81 m pitch | one-way |
| hotel | room | 16 per floor, along both sides of a corridor | /night |
| hotel | suite | 8 per floor, bed and sofa | /night |
| hotel | penthouse | up to 2 units across a full floor | /night |
| hotel | amenity | open floor with tables | /night |
| office | desks | 16 per 8 m bay | /desk/mo |
| office | offices | 4 glass offices per bay, 4 desks each | /office/mo |
| office | meeting | 2 glass rooms per bay with a long table | /hr |
| office | lounge | sofas and tables, 30 per bay | included |
| office | event | theatre seating and a stage, 60 per bay | /day |

### Ordering

- **Plane:** nose to tail, in the order residence, first, business, bar, premium, economy.
- **Hotel:** from the ground up, in the order room, amenity, suite, penthouse, cheapest first within each type.
- **Office:** in the order given, filling bays from the ground floor up.

## Developments: one value per apartment

A `development` is not made of 2–6 zones. `normalize()` generates every apartment from the shell (buildings × floors × units per floor, so up to 384), and each apartment is its own zone with its own value, hit box and card.

- **Naming:** buildings are lettered A, B, C… (front row first, left to right); apartment numbers are floor then unit, so `B · 302` is building B, level 3, unit 2.
- **Example values:** each value is worked out from `basePrice`, scaled by floor area and raised 3.5% per floor, 1.8% per building and 0.3% per unit along the floor. These are labelled `example value` and the card says they are not a market appraisal.
- **Provided values:** a `zones` entry `{ "building": 1, "floor": 2, "unit": 1, "price": 777000, "bedrooms": 3, "area": 110 }` overrides that one apartment. When it includes `price`, the apartment is labelled `provided value`. Entries without `price` change only the bedrooms or area, and the value stays an example.
- **Defaults:** odd-numbered units are 1 bed / 64 m², even-numbered units 2 bed / 80 m².
- **Upgrade** in the balcony view goes to the same apartment one floor up.

