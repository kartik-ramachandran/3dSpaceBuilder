/*
 * Studio rendering for the interiors page: MSAA, contact shadows (GTAO) that fade in once the camera and
 * the pointer are still (so orbiting and dragging stay smooth), a faint bloom on lamps and screens, and
 * tone mapping at the end. Quality steps down by itself on slow machines.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** GTAO at a reduced resolution that ignores glass, labels and helper lines. */
class ContactShadows extends GTAOPass {
  constructor(scene, camera, w, h, scale) { super(scene, camera, w, h); this.resScale = scale; }
  setSize(w, h) { super.setSize(Math.max(1, Math.round(w * this.resScale)), Math.max(1, Math.round(h * this.resScale))); }
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.userData.glass || m?.transparent || m?.visible === false) o.visible = false;
    });
  }
}

export function createStudioRenderer({ renderer, scene, camera, aoStrength = 1 }) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new ContactShadows(scene, camera, size.x, size.y, 0.6);
  ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.4, scale: 1.15, samples: 16, distanceFallOff: 1 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  ao.blendIntensity = 0;
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.16, 0.5, 2.2);   // only lamps and screens bloom, not sunlit walls
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const last = new THREE.Matrix4(); let still = 0, busy = 0, strength = aoStrength;
  const quality = { level: 0, slow: 0, fast: 0 };
  const ratios = [Math.min(devicePixelRatio, 2), Math.min(devicePixelRatio, 1.5), 1, 0.8];

  function setSize(w, h) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
  function adapt(ms) {
    if (ms > 26) { quality.slow += ms; quality.fast = 0; } else if (ms < 17) { quality.fast += ms; quality.slow = Math.max(0, quality.slow - ms); }
    const set = (l) => { quality.level = l; quality.slow = quality.fast = 0; renderer.setPixelRatio(ratios[l]); setSize(innerWidth, innerHeight); bloom.enabled = l < 3; };
    if (quality.slow > 1500 && quality.level < 3) set(quality.level + 1);
    else if (quality.fast > 15000 && quality.level > 0) set(quality.level - 1);
  }
  renderer.setPixelRatio(ratios[0]);

  return {
    composer, ao, bloom, setSize,
    /** Something is being dragged or edited: keep the view light until it settles. */
    poke() { busy = 0.25; },
    setAOStrength(k) { strength = k; },
    render(dt, frameMs) {
      camera.updateMatrixWorld();
      const moving = !camera.matrixWorld.equals(last); last.copy(camera.matrixWorld);
      busy = Math.max(0, busy - dt);
      still = moving || busy > 0 ? 0 : still + dt;
      // contact shadows fade in over ~0.3 s once still, and drop out instantly when moving
      const want = still > 0.12 ? strength : 0;
      ao.blendIntensity = want ? Math.min(want, ao.blendIntensity + dt * 3.5 * strength) : 0;
      ao.enabled = ao.blendIntensity > 0.01;
      composer.render(dt);
      if (frameMs && frameMs < 500) adapt(frameMs);
    },
  };
}

/**
 * Lightmapped (baked) materials already contain every light in the scene: stop real-time lights from adding
 * to them, so a sun and lamps can light new furniture without washing out the Blender bake.
 */
export function ignoreDirectLight(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
      '#undef RE_Direct\n#define RE_Direct(a, b, c, d, e, f, g)\n#include <lights_fragment_begin>');
  };
  material.customProgramCacheKey = () => 'baked-no-direct';
  material.needsUpdate = true;
}
