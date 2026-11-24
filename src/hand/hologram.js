/*
 * Hologram of a residential development for hand mode. Same site layout as scene/development.js,
 * but every building is split into floor groups so floors can lift apart (explode) and be pulled out.
 * Each apartment is a translucent additive volume with glowing edges, coloured by its valuation.
 */
import * as THREE from 'three';

const UW = 7.5, D = 11, FH = 3.2, GAP_X = 16, GAP_Z = 26;
export const HOLO = { edge: '#7fe6ff', low: new THREE.Color('#1b5d8c'), high: new THREE.Color('#bff6ff'), none: new THREE.Color('#47536b'), hover: new THREE.Color('#ffd23f'), pick: new THREE.Color('#ff5fd2') };

export function buildHologram(spec, data) {
  const { buildings, rows, floors, unitsPerFloor } = spec.shell;
  const cols = Math.ceil(buildings / rows);
  const BX = unitsPerFloor * UW;
  const siteX = cols * BX + (cols - 1) * GAP_X, siteZ = rows * D + (rows - 1) * GAP_Z;
  const origin = (b) => {
    const i = b - 1, r = Math.floor(i / cols), c = i % cols;
    const inRow = Math.min(cols, buildings - r * cols), rowW = inRow * BX + (inRow - 1) * GAP_X;
    return new THREE.Vector3(-rowW / 2 + BX / 2 + c * (BX + GAP_X), 0, siteZ / 2 - D / 2 - r * (D + GAP_Z));
  };

  const root = new THREE.Group();                 // turned and scaled by the app
  const model = new THREE.Group(); root.add(model);
  const scale = 2.3 / Math.max(siteX, siteZ);
  model.scale.setScalar(scale);

  const unitGeo = new THREE.BoxGeometry(UW - 0.6, FH - 0.55, D - 0.8);
  const unitEdges = new THREE.EdgesGeometry(unitGeo);
  const slabEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(BX + 0.6, 0.12, D + 0.6));
  const slabMat = new THREE.LineBasicMaterial({ color: HOLO.edge, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const lo = data.min, hi = data.max;
  const baseColor = (id) => { const l = data.byZone.get(id)?.latest; return l ? HOLO.low.clone().lerp(HOLO.high, hi > lo ? (l.rate - lo) / (hi - lo) : 0.5) : HOLO.none.clone(); };

  const floorGroups = new Map(), units = new Map(), pickables = [];
  for (let b = 1; b <= buildings; b++) {
    const o = origin(b);
    for (let f = 1; f <= floors; f++) {
      const g = new THREE.Group();
      g.position.set(o.x, (f - 1) * FH, o.z);
      g.userData = { building: b, floor: f, baseY: (f - 1) * FH, pull: new THREE.Vector3(), pullTarget: new THREE.Vector3() };
      g.add(new THREE.LineSegments(slabEdges, slabMat));
      model.add(g); floorGroups.set(`${b}-${f}`, g);
    }
  }
  for (const z of spec.zones) {
    const g = floorGroups.get(`${z.building}-${z.floor}`);
    const x = -BX / 2 + (z.unit - 0.5) * UW;
    const color = baseColor(z.id);
    const fill = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));   // normal blending keeps the valuation colours readable
    fill.position.set(x, FH / 2, 0);
    fill.userData.zone = z.id;
    const edge = new THREE.LineSegments(unitEdges, new THREE.LineBasicMaterial({ color: color.clone().lerp(new THREE.Color('#ffffff'), 0.35), transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }));
    edge.position.copy(fill.position);
    g.add(fill, edge);
    units.set(z.id, { fill, edge, base: color, zone: z, group: g });
    pickables.push(fill);
  }

  // Building labels
  const labels = [];
  for (let b = 1; b <= buildings; b++) {
    const o = origin(b), s = textSprite(`BUILDING ${String.fromCharCode(64 + b)}`);
    s.position.set(o.x, floors * FH + 4, o.z); s.scale.multiplyScalar(1 / scale * 0.11);
    s.userData = { building: b }; model.add(s); labels.push(s);
  }

  // Projector base: concentric rings and radial ticks under the site
  const base = new THREE.Group(); root.add(base);
  const ringMat = new THREE.LineBasicMaterial({ color: HOLO.edge, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const r of [1.32, 1.42, 1.62]) {
    const pts = []; for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    base.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  }
  const ticks = [];
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, r0 = 1.45, r1 = i % 6 ? 1.52 : 1.58; ticks.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  const tickRing = new THREE.LineSegments(tg, ringMat); base.add(tickRing);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.32, 96), new THREE.MeshBasicMaterial({ color: '#0c3a55', transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; base.add(disc);
  base.position.y = -0.01;

  let explode = 0;
  return {
    root, model, base, units, pickables, floorGroups, scale, floors,
    height: floors * FH * scale,
    /** k: 0 assembled … 1 fully exploded. */
    setExplode(k) { explode = THREE.MathUtils.clamp(k, 0, 1); },
    get explode() { return explode; },
    setUnitColor(id, color) { const u = units.get(id); if (!u) return; u.fill.material.color.copy(color); u.edge.material.color.copy(color).lerp(new THREE.Color('#ffffff'), 0.35); },
    resetColor(id) { const u = units.get(id); if (u) this.setUnitColor(id, u.base); },
    /** follow: true while the user's hands are driving the model, so floors track them 1:1 instead of easing. */
    update(dt, t, follow = false) {
      tickRing.rotation.y = t * 0.08;
      const ease = (rate) => follow ? 1 : 1 - Math.exp(-dt * rate);
      for (const g of floorGroups.values()) {
        const ud = g.userData;
        ud.pull.lerp(ud.pullTarget, ease(10));
        const targetY = ud.baseY + (ud.floor - 1) * explode * FH * 1.9;
        g.position.y += (targetY - g.position.y) * ease(9);
        const o = origin(ud.building);
        g.position.x = o.x + ud.pull.x; g.position.z = o.z + ud.pull.z;
      }
      for (const s of labels) s.position.y = (floors - 1) * FH * (1 + explode * 1.9) + FH + 4;
    },
    clearPulls() { for (const g of floorGroups.values()) g.userData.pullTarget.set(0, 0, 0); },
  };
}

function textSprite(text) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), px = 44;
  g.font = `600 ${px}px "Share Tech Mono", ui-monospace, Consolas, monospace`;
  c.width = Math.ceil(g.measureText(text).width) + 40; c.height = px + 28;
  g.font = `600 ${px}px "Share Tech Mono", ui-monospace, Consolas, monospace`;
  g.strokeStyle = 'rgba(127,230,255,.85)'; g.lineWidth = 3; g.strokeRect(2, 2, c.width - 4, c.height - 4);
  g.fillStyle = 'rgba(8,30,48,.55)'; g.fillRect(3, 3, c.width - 6, c.height - 6);
  g.fillStyle = '#bff6ff'; g.textBaseline = 'middle'; g.fillText(text, 20, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  s.renderOrder = 10;
  s.scale.set(c.width / c.height, 1, 1); return s;
}
