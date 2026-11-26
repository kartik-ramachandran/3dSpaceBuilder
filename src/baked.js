/*
 * Shared set-up for models with lighting baked in Blender (scripts/bake/bakelib.py).
 *
 * Lightmapped meshes carry a second UV set (uv1). The bake stores diffuse light without surface colour,
 * multiplied by `scale`, in sRGB; three.js multiplies lightMap by albedo / π, so intensity = π / scale.
 * A lightmap needs the mesh's uv1, but materials can be shared with real-time meshes that have none, so
 * baked meshes get their own lightmapped copy of any such material.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export async function loadLightmap(url) {
  const t = await new THREE.TextureLoader().loadAsync(url);
  t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.channel = 1;
  return t;
}

/** Applies a lightmap to every mesh under `root` that has uv1. Returns the set of lightmapped materials. */
export function applyLightmap(root, lightmap, scale, { envOnBaked = 0.02, envOnLive = 0.9 } = {}) {
  const live = new Set();
  root.traverse((o) => { if (o.isMesh && !o.geometry.attributes.uv1) [].concat(o.material).forEach((m) => live.add(m)); });
  const copies = new Map(), baked = new Set();
  const lit = (m) => {
    if (copies.has(m)) return copies.get(m);
    const b = live.has(m) ? m.clone() : m;
    // the bake holds all the diffuse light; sky light on top would wash its shadows out (keep a trace for reflections)
    b.lightMap = lightmap; b.lightMapIntensity = Math.PI / scale; b.envMapIntensity = envOnBaked; b.needsUpdate = true;
    copies.set(m, b); baked.add(b); return b;
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry.attributes.uv1) o.material = Array.isArray(o.material) ? o.material.map(lit) : lit(o.material);
    else for (const m of [].concat(o.material)) {
      if (m.transmission > 0 || /glass|glazing|balustrade/i.test(m.name)) { m.transparent = true; m.depthWrite = false; }
      else m.envMapIntensity = envOnLive;
    }
  });
  return baked;
}

/** The packed sky photographs in assets/hdri (base64 Radiance HDR) as an environment and optional background. */
export async function loadSky(renderer, url, { background = false } = {}) {
  const txt = await (await fetch(url)).text();
  const bin = Uint8Array.from(atob(txt.trim()), (c) => c.charCodeAt(0));
  const r = new RGBELoader().setDataType(THREE.HalfFloatType).parse(bin.buffer);
  const tex = new THREE.DataTexture(r.data, r.width, r.height, THREE.RGBAFormat, THREE.HalfFloatType);
  Object.assign(tex, { mapping: THREE.EquirectangularReflectionMapping, colorSpace: THREE.LinearSRGBColorSpace, flipY: true, needsUpdate: true });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture; pmrem.dispose();
  return { env, background: background ? tex : (tex.dispose(), null) };
}
