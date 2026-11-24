# Thane Atlas

Open `thane.html` through the local server (`npm run dev`). The builder also has a **Thane Atlas** link. `npm run build` writes `dist/thane.html` and its local MapLibre assets alongside the existing builder.

The journey has three reversible stages: Thane city, Vrindavan neighbourhood, and the illustrative apartment development. Drag/zoom the map, orbit, switch between imagery and map, toggle surrounding buildings and simulated street life, or use Street view for a close look. Choose building, floor, and flat in the valuation panel, or click a rendered flat. Focus on this flat centres the camera on the selection.

## Data and boundaries

- Vrindavan focus: 19.209007 N, 72.983287 E, a neighbourhood reference, **not a verified development parcel**. [Coordinate reference](https://www.findlatitudeandlongitude.com/l/Vrindavan%2BSociety%2C%2BRabodi%2C%2BThane%2C%2BMaharashtra%2C%2B400606%2C%2BIndia/6107152/).
- Real streets, labels and building footprints come from OpenStreetMap via [OpenFreeMap](https://openfreemap.org). Heights use mapped values where available, with a 12 m fallback. These are extruded map footprints, not a photogrammetry reconstruction of Thane.
- Satellite imagery comes from Esri World Imagery with provider attribution. [Imagery documentation](https://doc.arcgis.com/en/data-appliance/2025/maps/world-imagery.htm).
- The three 100-storey towers and six lower buildings are the existing procedural concept placed at that illustrative location. They are not claimed to exist in Vrindavan. The concept's local roads and landscaping are illustrative too; its synthetic river, motorway and surrounding skyline are omitted from this geographic page.
- 180 pedestrians and additional traffic are simulated. They are not live crowd measurements.
- All 1,296 flats have deterministic **dummy INR values** generated from an illustrative INR 8,500,000 starting price. This is a separate INR demonstration, not a currency conversion of the builder's NZD defaults. No actual property valuation is asserted.
- Map tiles and imagery require network access. Apartment browsing remains available if WebGL or remote data fails. Reduced-motion preferences stop automatic street animation and shorten camera moves.

## Implementation and checks

`src/thane/main.js` manages the map, three-stage camera and valuation UI. `development-layer.js` anchors the shared Three.js development to MapLibre's Mercator coordinates and translates map clicks into flat selections. `street-life.js` batches pedestrians into seven instanced meshes. Assets are bundled by `scripts/build.mjs`.

Run `npm run test:thane` (set `CHROME_PATH` if needed) for the real-map browser check: city/neighbourhood/development transitions, floor 100, pointer picking, per-flat value selection, close street view, return navigation and mobile overflow. The test uses the live map services, so requires internet access. It writes review screenshots under `docs/thane-*.png`.

This is a browser-based Three.js/MapLibre experience, not a Unity/Unreal build or photorealistic city scan.
