/*
 * Real water areas (from OpenStreetMap) rendered as moving, reflective water: two layers of ripples
 * drifting at different speeds, sky reflection that strengthens at grazing angles (Fresnel), and sun glints.
 */
import * as THREE from 'three';

/** A tileable ripple normal map, generated once from layered waves (no image asset needed). */
function rippleNormals(size = 256) {
  const h = new Float32Array(size * size), TAU = Math.PI * 2;
  const waves = [[3, 1, 0.9, 0.3], [1, 4, 0.7, 1.7], [5, 3, 0.45, 2.4], [7, -2, 0.35, 0.8], [2, -6, 0.3, 4.1], [11, 5, 0.18, 2.2], [-9, 8, 0.16, 5.0], [13, -11, 0.1, 1.1]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0; for (const [kx, ky, a, p] of waves) v += a * Math.sin(TAU * (kx * x + ky * y) / size + p);
    h[y * size + x] = v;
  }
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const at = (dx, dy) => h[((y + dy + size) % size) * size + ((x + dx + size) % size)];
    const nx = (at(-1, 0) - at(1, 0)) * 1.4, ny = (at(0, -1) - at(0, 1)) * 1.4, l = Math.hypot(nx, ny, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8;
  return t;
}

const vertexShader = `
  varying vec3 vWorld;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const fragmentShader = `
  uniform sampler2D tNormal; uniform float time; uniform vec3 camPos, sunDir, sunColor, deep, shallow, skyTop, horizon;
  varying vec3 vWorld;
  vec3 tap(vec2 uv) { vec3 n = texture2D(tNormal, uv).rgb * 2.0 - 1.0; return vec3(n.x, n.z, n.y); }   // tangent space → y up
  void main() {
    vec2 p = vWorld.xz;
    vec3 n = tap(p / 23.0 + vec2(time * 0.011, time * 0.007)) + tap(p / 8.5 + vec2(-time * 0.019, time * 0.013)) + tap(p / 3.1 + vec2(time * 0.031, -time * 0.024)) * 0.5;
    n = normalize(vec3(n.x * 0.55, n.y, n.z * 0.55));
    vec3 V = normalize(camPos - vWorld);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(horizon, skyTop, clamp(R.y * 1.6, 0.0, 1.0));
    float glint = pow(max(dot(R, sunDir), 0.0), 220.0) * 3.0 + pow(max(dot(R, sunDir), 0.0), 18.0) * 0.08;
    vec3 body = mix(deep, shallow, 0.35 + 0.25 * n.x);
    vec3 col = mix(body, sky, fres * 0.85) + sunColor * glint;
    gl_FragColor = vec4(col, 0.93);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export function buildWater(water) {
  const group = new THREE.Group(); group.name = 'Real water (OpenStreetMap)';
  const tNormal = rippleNormals();
  const lin = (hex) => new THREE.Color(hex);   // THREE.Color converts sRGB hex to linear working space
  const uniforms = {
    tNormal: { value: tNormal }, time: { value: 0 }, camPos: { value: new THREE.Vector3(0, 400, 400) },
    sunDir: { value: new THREE.Vector3(-260, 480, 210).normalize() }, sunColor: { value: lin('#fff1d6') },
    deep: { value: lin('#243b33') }, shallow: { value: lin('#4d5f45') }, skyTop: { value: lin('#7b9db8') }, horizon: { value: lin('#d6dcd8') },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, side: THREE.DoubleSide });
  const geos = [];
  for (const w of water) {
    const shape = new THREE.Shape(w.rings[0].map((p) => new THREE.Vector2(p.x, p.z)));
    for (const hole of w.rings.slice(1)) if (hole.length > 3) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.z))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(Math.PI / 2).translate(0, 0.28, 0);   // shape (x, z) → plane y = 0.28, just above the imagery
    geos.push(g);
  }
  for (const g of geos) { const m = new THREE.Mesh(g, material); m.renderOrder = 1; m.userData.noShadow = true; group.add(m); }
  return {
    group,
    update(t, camLocal) { uniforms.time.value = t; if (camLocal) uniforms.camPos.value.set(camLocal.x, camLocal.y, camLocal.z); },
    dispose() { group.traverse((o) => o.geometry?.dispose()); material.dispose(); tNormal.dispose(); },
  };
}
