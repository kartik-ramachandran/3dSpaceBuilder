/*
 * A detailed street network from straight, axis-aligned road segments: asphalt with gutters, raised
 * kerbs and paved footpaths, rounded kerb corners at junctions, centre and edge lines that stop at
 * junctions, stop lines and zebra crossings on every junction approach, working traffic lights at
 * crossroads, manhole covers, street-name signs and a bus shelter.
 *
 *   buildStreets([{ axis: 'x', at: z, from: x0, to: x1, width: 7 }, …], { y, footpath, lib, names })
 *   → { group, update(dt, t) }        (y is the road surface height)
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { planarUV, pbr, GRASS } from './real-surroundings.js';
import { instanceParts, place } from './asset-library.js';

const KERB_H = 0.14, KERB_W = 0.3, CORNER_R = 5, GUTTER = 0.45;

let M = null;
function materials() {
  if (M) return M;
  M = {
    asphalt: pbr('asphalt_02', { color: '#9a9a9a', normalScale: 0.6 }),
    gutter: new THREE.MeshStandardMaterial({ color: '#3a3c3d', roughness: 0.95 }),
    pavers: pbr('pavers', { color: '#d8d3c9', normalScale: 0.7, side: THREE.DoubleSide }),
    kerb: new THREE.MeshStandardMaterial({ color: '#c8c4ba', roughness: 0.8, side: THREE.DoubleSide }),
    white: new THREE.MeshStandardMaterial({ color: '#f2f0ea', roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    yellow: new THREE.MeshStandardMaterial({ color: '#e8c33a', roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    iron: new THREE.MeshStandardMaterial({ color: '#2d2f31', roughness: 0.5, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    pole: new THREE.MeshStandardMaterial({ color: '#3b4045', roughness: 0.45, metalness: 0.6 }),
    signal: new THREE.MeshStandardMaterial({ color: '#1d1f21', roughness: 0.5 }),
    sign: new THREE.MeshStandardMaterial({ color: '#1f6b3a', roughness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#cfe0e6', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }),
    shelterRoof: new THREE.MeshStandardMaterial({ color: '#4a5056', roughness: 0.4, metalness: 0.5 }),
    bench: new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.7 }),
    verge: new THREE.MeshStandardMaterial({ color: GRASS, roughness: 1, side: THREE.DoubleSide }),
    lamps: ['#ff3b2f', '#ffb21f', '#2fe07a'].map((c) => new THREE.MeshStandardMaterial({ color: '#202020', emissive: c, emissiveIntensity: 0.05 })),
  };
  return M;
}

/** Map local (u along the road, v across) to world xz for a segment. */
/** A grassed slope from a footpath's outer edge (p0 → p1 at height `hi`) down to the ground, `out` metres outwards (dx, dz). */
export function verge(x0, z0, x1, z1, dx, dz, hi, lo = 0.01) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, hi, z0, x1, hi, z1, x1 + dx, lo, z1 + dz, x0, hi, z0, x1 + dx, lo, z1 + dz, x0 + dx, lo, z0 + dz], 3));
  g.computeVertexNormals(); return g;
}
const toWorld = (seg, u, v) => (seg.axis === 'x' ? [u, seg.at + v] : [seg.at + v, u]);
function boxAt(seg, u0, u1, v0, v1, y0, y1) {
  const [ax, az] = toWorld(seg, u0, v0), [bx, bz] = toWorld(seg, u1, v1);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** A flat pad from a 2D shape in a corner's local frame (u, v ≥ 0 away from the junction), raised to `top`. */
function cornerPad(shape, px, pz, sx, sz, bottom, top) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: top - bottom, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(Math.PI / 2);                     // shape (x, y) → (x, ·, y); extrusion goes down from y = 0
  g.translate(0, top, 0);
  g.scale(sx, 1, sz); g.translate(px, 0, pz);
  return g;
}

export function buildStreets(segments, { y = 0.47, footpath = 2.8, lib = null, names = [], busStop = null } = {}) {
  const mats = materials(), group = new THREE.Group(); group.name = 'Streets';
  const asphalt = [], gutters = [], paths = [], kerbs = [], white = [], yellow = [], manholes = [], verges = [];
  const slope = Math.max(1.2, (y + KERB_H) * 4);                 // verge width: a gentle grassed slope
  const top = y + KERB_H, base = y - 0.3;

  // junctions: where an x road crosses a z road
  const junctions = [];
  for (const a of segments) for (const b of segments) {
    if (a.axis !== 'x' || b.axis !== 'z') continue;
    if (b.at >= a.from - 0.01 && b.at <= a.to + 0.01 && a.at >= b.from - 0.01 && a.at <= b.to + 0.01) {
      const ends = { xNeg: b.at > a.from + 1, xPos: b.at < a.to - 1, zNeg: a.at > b.from + 1, zPos: a.at < b.to - 1 };
      junctions.push({ x: b.at, z: a.at, hw: a.width / 2, hv: b.width / 2, ends, four: Object.values(ends).every(Boolean) });
    }
  }
  const junctionsOn = (seg) => junctions.filter((j) => (seg.axis === 'x' ? j.z === seg.at : j.x === seg.at)).map((j) => ({ j, u: seg.axis === 'x' ? j.x : j.z, half: seg.axis === 'x' ? j.hv : j.hw }));

  for (const seg of segments) {
    const hw = seg.width / 2, js = junctionsOn(seg).sort((p, q) => p.u - q.u);
    // runs of plain road between junction boxes
    const cuts = [{ u: seg.from, j: null }, ...js.flatMap(({ u, half, j }) => [{ u: u - half, j, side: -1 }, { u: u + half, j, side: 1 }]), { u: seg.to, j: null }];
    for (let k = 0; k < cuts.length; k += 2) {
      const a = cuts[k], b = cuts[k + 1]; if (b.u - a.u < 0.5) continue;
      const atJ0 = !!a.j, atJ1 = !!b.j;
      asphalt.push(planarUV(boxAt(seg, a.u, b.u, -hw, hw, base, y), 7));
      for (const s of [-1, 1]) {
        gutters.push(boxAt(seg, a.u, b.u, s * (hw - GUTTER), s * hw, y, y + 0.004));
        // kerb and footpath stop short of a junction where the corner takes over
        const k0 = a.u + (atJ0 ? CORNER_R : 0), k1 = b.u - (atJ1 ? CORNER_R : 0);
        if (k1 > k0) {
          kerbs.push(boxAt(seg, k0, k1, s * hw, s * (hw + KERB_W), base, top + 0.01));
          paths.push(planarUV(boxAt(seg, k0, k1, s * (hw + KERB_W), s * (hw + footpath), base, top), 2.4));
          const [ax, az] = toWorld(seg, k0, s * (hw + footpath)), [bx, bz] = toWorld(seg, k1, s * (hw + footpath)), [ox, oz] = toWorld(seg, 0, s * slope);
          verges.push(verge(ax, az, bx, bz, ox - (seg.axis === 'x' ? 0 : seg.at), oz - (seg.axis === 'x' ? seg.at : 0), top));
        }
        // edge line (solid), short of junction mouths
        const e0 = a.u + (atJ0 ? 2 : 1), e1 = b.u - (atJ1 ? 2 : 1);
        if (e1 > e0) white.push(boxAt(seg, e0, e1, s * (hw - 0.62), s * (hw - 0.5), y, y + 0.006));
      }
      // open road ends slope down to the ground
      for (const [end, dir, isEnd] of [[a.u, -1, !atJ0 && k === 0], [b.u, 1, !atJ1 && k + 1 === cuts.length - 1]]) {
        if (!isEnd) continue;
        const [p0x, p0z] = toWorld(seg, end, -(hw + footpath)), [p1x, p1z] = toWorld(seg, end, hw + footpath);
        const d = dir * slope;
        verges.push(seg.axis === 'x' ? verge(p0x, p0z, p1x, p1z, d, 0, top) : verge(p0x, p0z, p1x, p1z, 0, d, top));
      }
      // centre line: dashed, solid for the last 12 m before a junction (a solid double line on four lanes)
      const c0 = a.u + (atJ0 ? 12 : 2), c1 = b.u - (atJ1 ? 12 : 2);
      if ((seg.lanes || 2) >= 4) {
        for (const v of [-0.18, 0.06]) white.push(boxAt(seg, a.u + (atJ0 ? 6.5 : 1), b.u - (atJ1 ? 6.5 : 1), v, v + 0.12, y, y + 0.006));
        const lw = (hw - 0.6) / 2;
        for (const v of [-lw, lw]) for (let u = c0; u + 3 < c1; u += 9) white.push(boxAt(seg, u, u + 3, v - 0.06, v + 0.06, y, y + 0.006));
      } else for (let u = c0; u + 3 < c1; u += 9) white.push(boxAt(seg, u, u + 3, -0.06, 0.06, y, y + 0.006));
      if (atJ0 && (seg.lanes || 2) < 4) white.push(boxAt(seg, a.u + 6.5, Math.min(c0, b.u - 1), -0.06, 0.06, y, y + 0.006));
      if (atJ1 && (seg.lanes || 2) < 4) white.push(boxAt(seg, Math.max(c1, a.u + 1), b.u - 6.5, -0.06, 0.06, y, y + 0.006));
      // junction approaches: zebra crossing, then a stop line across the inbound lane
      for (const [end, dir] of [[atJ0 ? a.u : null, 1], [atJ1 ? b.u : null, -1]]) {
        if (end === null) continue;
        const z0 = end + dir * 1.0, z1 = end + dir * 4.0;
        for (let v = -hw + 0.7; v < hw - 0.5; v += 1.0) white.push(boxAt(seg, Math.min(z0, z1), Math.max(z0, z1), v, v + 0.5, y, y + 0.006));
        const sl = end + dir * 5.2, inbound = dir > 0 ? 1 : -1;       // traffic drives on the left: inbound lane side
        white.push(boxAt(seg, Math.min(sl, sl + dir * 0.4), Math.max(sl, sl + dir * 0.4), inbound > 0 ? 0.1 : -hw + 0.6, inbound > 0 ? hw - 0.6 : -0.1, y, y + 0.006));
      }
      // manhole covers now and then
      for (let u = a.u + 17; u < b.u - 10; u += 46) { const [mx, mz] = toWorld(seg, u, (Math.floor(u) % 2 ? 1 : -1) * hw * 0.45); manholes.push(new THREE.CylinderGeometry(0.34, 0.34, 0.012, 20).translate(mx, y + 0.006, mz)); }
    }
  }

  // junction boxes (asphalt, widened under the rounded corners) and the four kerb corners
  for (const j of junctions) {
    // asphalt as a cross: the crossing square, each arm out to the end of its kerb corner, and rounded fillets
    const slabXZ = (x0, x1, z0, z1) => asphalt.push(planarUV(new THREE.BoxGeometry(x1 - x0, y - base, z1 - z0).translate((x0 + x1) / 2, (y + base) / 2, (z0 + z1) / 2), 7));
    slabXZ(j.x - j.hv - (j.ends.xNeg ? CORNER_R : 0), j.x + j.hv + (j.ends.xPos ? CORNER_R : 0), j.z - j.hw, j.z + j.hw);
    slabXZ(j.x - j.hv, j.x + j.hv, j.z - j.hw - (j.ends.zNeg ? CORNER_R : 0), j.z + j.hw + (j.ends.zPos ? CORNER_R : 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = j.x + sx * j.hv, pz = j.z + sz * j.hw;
      // only where both roads continue past the corner on this side… otherwise the plain kerb carries on
      const xGoes = sx < 0 ? j.ends.xNeg : j.ends.xPos, zGoes = sz < 0 ? j.ends.zNeg : j.ends.zPos;
      const R = CORNER_R, f = footpath + 0;
      if (xGoes && zGoes) {
        // the footpath follows the kerb round the corner: a curved band between radius R (kerb) and R − f
        const path = new THREE.Shape(); path.moveTo(R, 0); path.absarc(R, R, R, Math.PI * 1.5, Math.PI, true); path.lineTo(f, R); path.absarc(R, R, R - f, Math.PI, Math.PI * 1.5, false); path.lineTo(R, 0);
        paths.push(planarUV(cornerPad(path, px, pz, sx, sz, base, top), 2.4));
        // its inner edge slopes down to the ground (a fan to the corner's centre)
        const cx = px + sx * R, cz = pz + sz * R, pos = [];
        for (let k = 0; k < 10; k++) {
          const a0 = Math.PI + (k / 10) * Math.PI / 2, a1 = Math.PI + ((k + 1) / 10) * Math.PI / 2, r = R - f;
          pos.push(cx + sx * r * Math.cos(a0), top, cz + sz * r * Math.sin(a0), cx + sx * r * Math.cos(a1), top, cz + sz * r * Math.sin(a1), cx, 0.01, cz);
        }
        const fan = new THREE.BufferGeometry(); fan.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fan.computeVertexNormals(); verges.push(fan);
        const kerb = new THREE.Shape(); kerb.moveTo(R, 0); kerb.absarc(R, R, R, Math.PI * 1.5, Math.PI, true); kerb.lineTo(KERB_W, R); kerb.absarc(R, R, R - KERB_W, Math.PI, Math.PI * 1.5, false); kerb.lineTo(R, 0);
        kerbs.push(cornerPad(kerb, px, pz, sx, sz, base, top + 0.01));
        const fillet = new THREE.Shape(); fillet.moveTo(0, 0); fillet.lineTo(R, 0); fillet.absarc(R, R, R, Math.PI * 1.5, Math.PI, true); fillet.lineTo(0, 0);
        asphalt.push(planarUV(cornerPad(fillet, px, pz, sx, sz, base, y), 7));
      } else {
        // T-junction: the through-road's kerb and path continue straight across the closed side
        const len = 2 * (zGoes ? j.hw : j.hv) + 2 * R;
        if (!zGoes) { const zo = j.z + sz * (j.hw + footpath); verges.push(verge(j.x - len / 2, zo, j.x + len / 2, zo, 0, sz * slope, top)); }
        if (!xGoes) { const xo = j.x + sx * (j.hv + footpath); verges.push(verge(xo, j.z - len / 2, xo, j.z + len / 2, sx * slope, 0, top)); }
        if (!zGoes) { kerbs.push(new THREE.BoxGeometry(len, top + 0.01 - base, KERB_W).translate(j.x, (top + base) / 2, j.z + sz * (j.hw + KERB_W / 2))); paths.push(planarUV(new THREE.BoxGeometry(len, top - base, footpath - KERB_W).translate(j.x, (top + base) / 2, j.z + sz * (j.hw + KERB_W + (footpath - KERB_W) / 2)), 2.4)); }
        if (!xGoes) { kerbs.push(new THREE.BoxGeometry(KERB_W, top + 0.01 - base, len).translate(j.x + sx * (j.hv + KERB_W / 2), (top + base) / 2, j.z)); paths.push(planarUV(new THREE.BoxGeometry(footpath - KERB_W, top - base, len).translate(j.x + sx * (j.hv + KERB_W + (footpath - KERB_W) / 2), (top + base) / 2, j.z), 2.4)); }
      }
    }
    // a yellow box junction marking keeps the middle clear
    if (j.four) for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) yellow.push(new THREE.BoxGeometry(0.15, 0.006, 0.15).translate(j.x + dx * (j.hv - 1), y + 0.003, j.z + dz * (j.hw - 1)));
  }

  const add = (geos, mat, shadow = true) => { if (!geos.length) return null; const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat); m.receiveShadow = true; m.castShadow = shadow; m.userData.noShadow = !shadow; group.add(m); return m; };
  add(asphalt, mats.asphalt, false); add(gutters, mats.gutter, false); add(paths, mats.pavers); add(kerbs, mats.kerb);
  add(verges, mats.verge, false);
  add(white, mats.white, false); add(yellow, mats.yellow, false); add(manholes, mats.iron, false);

  /* ---------- traffic lights at crossroads (they cycle: one road green, then amber, then the other) ---------- */
  const heads = [];
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.08, 3.6, 10).translate(0, 1.8, 0);
  for (const j of junctions.filter((q) => q.four)) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = j.x + sx * (j.hv + 0.9), pz = j.z + sz * (j.hw + 0.9);
      const pole = new THREE.Mesh(poleGeo, mats.pole); pole.position.set(px, top, pz); pole.castShadow = true; group.add(pole);
      // each corner pole carries a head facing the traffic arriving along the x road on this side
      const facingX = sz > 0 ? -1 : 1;                             // left-hand traffic
      const head = new THREE.Group(); head.position.set(px, top + 3.0, pz); head.rotation.y = facingX > 0 ? Math.PI / 2 : -Math.PI / 2; group.add(head);
      head.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.95, 0.24), mats.signal), { castShadow: true }));
      const lights = mats.lamps.map((m, k) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), m.clone()); l.position.set(0, 0.3 - k * 0.3, 0.125); head.add(l); return l; });
      heads.push({ lights, road: 'x' });
      const head2 = head.clone(true); head2.rotation.y = sx > 0 ? 0 : Math.PI; group.add(head2);
      head2.children.slice(1).forEach((l) => { l.material = l.material.clone(); });   // its own lamps, out of phase with the first head
      heads.push({ lights: head2.children.slice(1), road: 'z' });
    }
  }

  /* ---------- street-name signs ---------- */
  const signTex = (text) => { const c = document.createElement('canvas'); c.width = 256; c.height = 48; const x = c.getContext('2d'); x.fillStyle = '#1f6b3a'; x.fillRect(0, 0, 256, 48); x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(3, 3, 250, 42); x.fillStyle = '#fff'; x.font = '600 26px system-ui, sans-serif'; x.textAlign = 'center'; x.fillText(text, 128, 33); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  junctions.forEach((j, i) => {
    const px = j.x - (j.hv + 2.2), pz = j.z + (j.hw + 2.2);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 8).translate(0, 1.4, 0), mats.pole); pole.position.set(px, top, pz); group.add(pole);
    const [n1, n2] = names[i % Math.max(1, names.length)] || ['Park Street', 'River Road'];
    for (const [txt, rot, h] of [[n1, 0, 2.75], [n2, Math.PI / 2, 2.5]]) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.22), new THREE.MeshStandardMaterial({ map: signTex(txt), side: THREE.DoubleSide, roughness: 0.5 }));
      blade.position.set(px, top + h, pz); blade.rotation.y = rot; group.add(blade);
    }
  });

  /* ---------- bus shelter ---------- */
  if (busStop) {
    const { x, z, rot } = busStop, s = new THREE.Group(); s.position.set(x, top, z); s.rotation.y = rot;
    const parts = [
      [new THREE.BoxGeometry(4.2, 0.08, 1.6).translate(0, 2.5, 0), mats.shelterRoof],
      [new THREE.BoxGeometry(4.0, 2.2, 0.03).translate(0, 1.25, 0.72), mats.glass],
      [new THREE.BoxGeometry(0.03, 2.2, 1.4).translate(-2.0, 1.25, 0.05), mats.glass],
      [new THREE.BoxGeometry(0.03, 2.2, 1.4).translate(2.0, 1.25, 0.05), mats.glass],
      [new THREE.BoxGeometry(2.6, 0.08, 0.45).translate(0, 0.48, 0.45), mats.bench],
      ...[-2.05, 2.05].flatMap((px) => [-0.7, 0.75].map((pz) => [new THREE.BoxGeometry(0.07, 2.5, 0.07).translate(px, 1.25, pz), mats.pole])),
      [new THREE.CylinderGeometry(0.04, 0.04, 2.9, 8).translate(2.6, 1.45, -0.6), mats.pole],
      [new THREE.BoxGeometry(0.5, 0.5, 0.04).translate(2.6, 2.7, -0.6), mats.sign],
    ];
    for (const [g, m] of parts) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = m !== mats.glass; s.add(mesh); }
    group.add(s);
  }

  // street lights along the footpaths are added by the caller (they already exist on the site)
  let phase = 0;
  return {
    group,
    update(dt, t) {
      phase = t % 24;                                 // x road: green 0–10, amber 10–12, red 12–24; z road the opposite
      for (const h of heads) {
        const p = h.road === 'x' ? phase : (phase + 12) % 24;
        const state = p < 10 ? 2 : p < 12 ? 1 : 0;
        h.lights.forEach((l, k) => { l.material.emissiveIntensity = k === state ? 2.2 : 0.04; });
      }
    },
  };
}
