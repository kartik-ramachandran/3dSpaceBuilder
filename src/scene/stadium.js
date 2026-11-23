import * as THREE from 'three';
import { box, cyl, merge, std, surface, instanced, hitMat } from './helpers.js';
import { buildSurroundings } from './surroundings.js';
import { lerp, rng, sum } from '../util.js';

// Extruded elliptical sectors keep the stepped bowl open in the middle.
function band(rx, rz, width, start, end, y, height) {
  const points = [], steps = Math.max(8, Math.ceil((end - start) * 24));
  for (let i = 0; i <= steps; i++) { const a = lerp(start, end, i / steps); points.push(new THREE.Vector2((rx + width) * Math.cos(a), -(rz + width) * Math.sin(a))); }
  for (let i = steps; i >= 0; i--) { const a = lerp(start, end, i / steps); points.push(new THREE.Vector2(rx * Math.cos(a), -rz * Math.sin(a))); }
  return new THREE.ExtrudeGeometry(new THREE.Shape(points), { depth: height, bevelEnabled: false, steps: 1 }).rotateX(-Math.PI / 2).translate(0, y, 0);
}

function pitchTexture(sport, width, length) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2048;
  const ctx = canvas.getContext('2d'), random = rng(51);
  ctx.fillStyle = '#377e3c'; ctx.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < 16; i++) { ctx.fillStyle = i % 2 ? '#3d8440' : '#347739'; ctx.fillRect(0, i * 128, 2048, 128); }
  for (let i = 0; i < 65000; i++) { ctx.fillStyle = random() < 0.5 ? 'rgba(8,38,10,.09)' : 'rgba(192,218,136,.09)'; ctx.fillRect(random() * 2048, random() * 2048, 1, 3); }
  ctx.translate(1024, 1024); ctx.scale(2048 / width, 2048 / length);
  ctx.strokeStyle = '#f0f2de'; ctx.fillStyle = '#f0f2de'; ctx.lineWidth = 0.14;
  const line = (x1, z1, x2, z2) => { ctx.beginPath(); ctx.moveTo(x1, z1); ctx.lineTo(x2, z2); ctx.stroke(); };
  const circle = (x, z, r) => { ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.stroke(); };
  if (sport === 'cricket') {
    ctx.beginPath(); ctx.ellipse(0, 0, 65, 59, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#a89c6a'; ctx.fillRect(-5.5, -12, 11, 24);
    ctx.fillStyle = '#c8b68b'; ctx.fillRect(-1.525, -10.06, 3.05, 20.12);
    for (const side of [-1, 1]) {
      line(-1.32, side * 10.06, 1.32, side * 10.06);
      line(-2, side * 8.84, 2, side * 8.84);
      for (const x of [-1.32, 1.32]) line(x, side * 8.84, x, side * 11.7);
    }
    ctx.setLineDash([0.6, 0.65]); circle(0, 0, 27.4); ctx.setLineDash([]);
  } else if (sport === 'football') {
    ctx.strokeRect(-34, -52.5, 68, 105); line(-34, 0, 34, 0); circle(0, 0, 9.15);
    ctx.beginPath(); ctx.arc(0, 0, 0.22, 0, Math.PI * 2); ctx.fill();
    for (const side of [-1, 1]) {
      ctx.strokeRect(-20.16, side < 0 ? -52.5 : 36, 40.32, 16.5);
      ctx.strokeRect(-9.16, side < 0 ? -52.5 : 47, 18.32, 5.5);
      ctx.beginPath(); ctx.arc(0, side * 41.5, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.rect(-34, -36, 68, 72); ctx.clip(); circle(0, side * 41.5, 9.15); ctx.restore();
    }
  } else {
    ctx.strokeRect(-35, -60, 70, 120);
    for (const z of [-50, -28, 0, 28, 50]) line(-35, z, 35, z);
    ctx.setLineDash([1, 1.4]);
    for (const z of [-40, -10, 10, 40]) line(-35, z, 35, z);
    for (const x of [-30, -20, 20, 30]) line(x, -50, x, 50);
    ctx.setLineDash([]);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  return texture;
}

function addGoals(group, sport, white) {
  if (sport === 'cricket') {
    const stumps = [];
    for (const side of [-1, 1]) {
      for (const x of [-0.115, 0, 0.115]) stumps.push(cyl(0.019, 0.019, 0.71, x, 1.03, side * 10.06, 12));
      stumps.push(box(0.27, 0.02, 0.025, 0, 1.395, side * 10.06));
    }
    const mesh = new THREE.Mesh(merge(stumps), white); mesh.name = 'Cricket wickets'; group.add(mesh); return;
  }
  const parts = [], nets = [];
  for (const side of [-1, 1]) {
    const z = side * (sport === 'football' ? 52.5 : 50), width = sport === 'football' ? 7.32 : 5.6;
    const height = sport === 'football' ? 2.44 : 12;
    for (const x of [-width / 2, width / 2]) parts.push(cyl(0.065, 0.065, height, x, 0.7 + height / 2, z, 16));
    parts.push(cyl(0.065, 0.065, width, 0, 0, 0, 16).rotateZ(Math.PI / 2).translate(0, 0.7 + (sport === 'football' ? 2.44 : 3), z));
    if (sport === 'football') {
      for (let x = -width / 2; x <= width / 2; x += 0.25) nets.push(new THREE.Vector3(x, 0.7, z + side * 2), new THREE.Vector3(x, 3.14, z + side * 2), new THREE.Vector3(x, 3.14, z + side * 2), new THREE.Vector3(x, 3.14, z));
      for (let y = 0.7; y <= 3.14; y += 0.25) {
        nets.push(new THREE.Vector3(-width / 2, y, z + side * 2), new THREE.Vector3(width / 2, y, z + side * 2));
        for (const x of [-width / 2, width / 2]) nets.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y, z + side * 2));
      }
    }
  }
  const goals = new THREE.Mesh(merge(parts), white); goals.name = sport === 'football' ? 'Football goals' : 'Rugby goalposts'; group.add(goals);
  if (nets.length) group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(nets), new THREE.LineBasicMaterial({ color: '#e2e7e0', transparent: true, opacity: 0.65 })));
}

export function buildStadium(sp) {
  const group = new THREE.Group(), zones = new Map(), roof = new THREE.Group();
  const sport = sp.shell.sport, tiers = sp.shell.tiers, rows = 12;
  const rx = sport === 'cricket' ? 75 : 54, rz = sport === 'cricket' ? 69 : sport === 'rugby' ? 86 : 77;
  const outerX = rx + tiers * 15 + 5, outerZ = rz + tiers * 15 + 5, H = tiers * 9 + 3;
  const metal = std('#747e86', { metalness: 0.8, roughness: 0.32 }), concrete = surface('stone', sp.design?.wallColor || '#bbbcb8');
  const white = std('#f4f2e9', { roughness: 0.43 });
  const pitchWidth = sport === 'cricket' ? 140 : 80, pitchLength = sport === 'cricket' ? 128 : sport === 'rugby' ? 126 : 116;
  const fieldGeo = sport === 'cricket' ? new THREE.CircleGeometry(1, 128).scale(pitchWidth / 2, pitchLength / 2, 1) : new THREE.PlaneGeometry(pitchWidth, pitchLength);
  const field = new THREE.Mesh(fieldGeo, std('#ffffff', { map: pitchTexture(sport, pitchWidth, pitchLength), roughness: 0.97, metalness: 0 }));
  field.name = `${sport} field`; field.rotation.x = -Math.PI / 2; field.position.y = 0.7; group.add(field);
  group.add(new THREE.Mesh(band(rx - 3, rz - 3, 3, 0, Math.PI * 2, 0.43, 0.18), std('#5e6261', { roughness: 0.95 })));
  addGoals(group, sport, white);
  const roofMat = new THREE.MeshPhysicalMaterial({ color: '#e4e8e7', metalness: 0.25, roughness: 0.35, transparent: true, side: THREE.DoubleSide });
  const capacity = sum(sp.zones.map((z) => z.capacity));
  const supportParts = [], railParts = [];
  sp.zones.forEach((z, section) => {
    const start = section / sp.zones.length * Math.PI * 2 + 0.025;
    const end = (section + 1) / sp.zones.length * Math.PI * 2 - 0.025;
    const angle = (start + end) / 2;
    const mats = {
      floor: std(sp.design?.floorColor || '#b7b8b2', { roughness: 0.9, emissive: z.color, emissiveIntensity: 0 }),
      furn: new THREE.MeshPhysicalMaterial({ color: sp.design?.upholsteryColor || ['#285d83', '#bd543d', '#447466', '#d4b073'][section % 4], roughness: 0.43, clearcoat: 0.3, emissive: z.color, emissiveIntensity: 0 }),
    };
    const steps = [], positions = [], rotations = [], hits = [];
    const hoverOutline = new THREE.Group(); hoverOutline.visible = false; hoverOutline.name = `${z.name} hover outline`;
    const outlineMat = new THREE.LineBasicMaterial({ color: '#ffe1a0', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    // Sample seats at large capacities while retaining continuous, complete tiers.
    const columns = Math.max(8, Math.min(150, Math.floor(Math.min(z.capacity, 10000 / sp.zones.length) / (rows * tiers))));
    for (let tier = 0; tier < tiers; tier++) {
      const offset = tier * 15, baseY = 1.2 + tier * 9;
      const border = [];
      for (let i = 0; i <= 64; i++) { const a = lerp(start, end, i / 64); border.push(new THREE.Vector3((rx + offset) * Math.cos(a), baseY + 0.55, (rz + offset) * Math.sin(a))); }
      for (let i = 64; i >= 0; i--) { const a = lerp(start, end, i / 64); border.push(new THREE.Vector3((rx + offset + 14.9) * Math.cos(a), baseY + 6.55, (rz + offset + 14.9) * Math.sin(a))); }
      const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(border), outlineMat); outline.renderOrder = 7; hoverOutline.add(outline);
      for (let row = 0; row < rows; row++) {
        const radius = offset + row * 1.04, y = baseY + row * 0.5;
        steps.push(band(rx + radius, rz + radius, 1.07, start, end, y, 0.5));
        for (let col = 0; col < columns; col++) {
          if (col % 24 < 2) continue; // radial aisles
          const a = lerp(start, end, (col + 0.5) / columns);
          const x = (rx + radius + 0.54) * Math.cos(a), zz = (rz + radius + 0.54) * Math.sin(a);
          positions.push(new THREE.Vector3(x, y + 0.5, zz)); rotations.push(Math.atan2(x, zz));
        }
      }
      const concourse = new THREE.Mesh(band(rx + offset + 12.5, rz + offset + 12.5, 2.4, start, end, baseY + 6, 0.35), concrete); group.add(concourse);
      const hit = new THREE.Mesh(band(rx + offset, rz + offset, 14.9, start, end, baseY, 7.5), hitMat);
      hit.userData.zone = z.id; group.add(hit); hits.push(hit);
      // Rails at the rear of each seating tier, with slender uprights.
      for (let i = 0; i < 18; i++) {
        const a = lerp(start, end, i / 17);
        railParts.push(cyl(0.035, 0.035, 1.0, (rx + offset + 14.6) * Math.cos(a), baseY + 6.8, (rz + offset + 14.6) * Math.sin(a), 8));
      }
      group.add(new THREE.Mesh(band(rx + offset + 14.55, rz + offset + 14.55, 0.08, start, end, baseY + 7.3, 0.07), metal));
    }
    group.add(new THREE.Mesh(merge(steps), mats.floor));
    group.add(hoverOutline);
    const seatGeo = merge([box(0.48, 0.085, 0.42, 0, 0.42, 0), box(0.48, 0.43, 0.065, 0, 0.67, 0.18), box(0.065, 0.4, 0.065, 0, 0.2, 0.1)]);
    const seatsMesh = instanced(seatGeo, mats.furn, positions, rotations); seatsMesh.name = `${z.name} seats`; group.add(seatsMesh);
    for (let i = 0; i < 10; i++) {
      const a = lerp(start, end, i / 9), x = (outerX - 2) * Math.cos(a), zz = (outerZ - 2) * Math.sin(a);
      supportParts.push(cyl(0.3, 0.45, H, x, H / 2, zz, 12));
    }
    roof.add(new THREE.Mesh(band(rx + (tiers - 1) * 15 + 3, rz + (tiers - 1) * 15 + 3, 16, start, end, H + 1, 0.4), roofMat));
    const seatTier = z.type === 'vip' || z.type === 'club' ? tiers - 1 : 0;
    const seatRadius = seatTier * 15 + 6;
    const eye = new THREE.Vector3((rx + seatRadius) * Math.cos(angle), 1.2 + seatTier * 9 + 3 + 1.65, (rz + seatRadius) * Math.sin(angle));
    zones.set(z.id, { z, mats, hits, hoverOutline,
      anchor: new THREE.Vector3((rx + 8) * Math.cos(angle), H + 3, (rz + 8) * Math.sin(angle)),
      center: new THREE.Vector3(0, seatTier * 9 + 4, 0),
      seats: [{ pos: eye, label: `${z.name} · Row 7`, note: `${seatTier ? 'upper' : 'lower'} tier · ${sport} field view` }],
      look: new THREE.Vector3(0, 0.8, 0).sub(eye).normalize(), floorsLabel: `${tiers} seating tier${tiers > 1 ? 's' : ''}`,
    });
  });
  group.add(new THREE.Mesh(merge(supportParts), concrete), new THREE.Mesh(merge(railParts), metal));
  roof.visible = sp.shell.roof; group.add(roof);
  // Four floodlight towers and luminous lamp arrays.
  const lamps = [], poles = [];
  for (const a of [0.7, 2.44, 3.84, 5.58]) {
    const x = (outerX + 8) * Math.cos(a), z = (outerZ + 8) * Math.sin(a), height = H + 15;
    poles.push(cyl(0.3, 0.65, height, x, height / 2, z, 16));
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) lamps.push(box(0.7, 0.45, 0.35, x + (col - 2) * 0.85, height - row * 0.6, z));
  }
  group.add(new THREE.Mesh(merge(poles), metal), new THREE.Mesh(merge(lamps), std('#fff8df', { emissive: '#fff5d6', emissiveIntensity: 1.4 })));
  const board = document.createElement('canvas'); board.width = 1024; board.height = 384;
  const ctx = board.getContext('2d'); ctx.fillStyle = '#10232c'; ctx.fillRect(0, 0, 1024, 384);
  ctx.textAlign = 'center'; ctx.fillStyle = '#e4ecdf'; ctx.font = '600 48px sans-serif'; ctx.fillText(sport.toUpperCase(), 512, 100);
  ctx.font = '600 84px sans-serif'; ctx.fillText('HOME   ·   AWAY', 512, 230); ctx.font = '28px sans-serif'; ctx.fillText(sp.name.slice(0, 36), 512, 320);
  const screenTexture = new THREE.CanvasTexture(board); screenTexture.colorSpace = THREE.SRGBColorSpace;
  const scoreboard = new THREE.Mesh(box(19, 7.2, 0.6, 0, H + 8, -outerZ), std('#ffffff', { map: screenTexture, roughness: 0.65 })); scoreboard.name = 'Scoreboard'; group.add(scoreboard);
  const root = new THREE.Group(); root.add(buildSurroundings('office', sp.shell.setting, outerX * 2, outerZ * 2), group);
  return {
    kind: 'stadium', sport, group: root, zones, levels: tiers, capacity, hasRoof: sp.shell.roof, glassLabel: 'Roof cutaway',
    fitBox: new THREE.Box3(new THREE.Vector3(-outerX - 12, 0, -outerZ - 12), new THREE.Vector3(outerX + 12, H + 18, outerZ + 12)),
    target: new THREE.Vector3(0, H * 0.25, 0),
    dirs: { wide: new THREE.Vector3(0.85, 1.2, 1), tall: new THREE.Vector3(0.4, 1.7, 1) },
    applyGlass(g) { roofMat.opacity = lerp(1, 0.1, g); roofMat.depthWrite = g < 0.02; },
    setView(on) { roof.visible = sp.shell.roof && !on; },
    update() {},
  };
}
