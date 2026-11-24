/*
 * Sky dome, image-based lighting from the sky, sun and fill light, and per-kind palettes
 * (dusk above the clouds, blue hour over the harbour, afternoon for offices).
 */
import * as THREE from 'three';

export function createAtmosphere(renderer, scene) {
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return new THREE.Vector3((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(5000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: rgb('#16214a') }, horizon: { value: rgb('#f0a46a') }, bottom: { value: rgb('#f3cfae') }, sunDir: { value: new THREE.Vector3(0.6, 0.06, -0.8).normalize() }, sunColor: { value: rgb('#ffd8a8') } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.55, h), 0.65)) : mix(horizon, bottom, smoothstep(0.0, 0.2, -h));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 2.0 + pow(s, 10.0) * 0.28);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }),
  );
  sky.renderOrder = -10;
  scene.add(sky);
  const pmrem = renderer ? new THREE.PMREMGenerator(renderer) : null;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material));
  let envRT = null;
  function refreshEnv() {
    if (!pmrem) return;
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene, 0.03);
    scene.environment = envRT.texture;
  }
  const hemi = new THREE.HemisphereLight(0xbcd2ff, 0xf2b98a, 0.9);
  const sun = new THREE.DirectionalLight(0xffe2c0, 1.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.00008;
  sun.shadow.radius = 2;
  const fill = new THREE.DirectionalLight('#dbe8ff', 0.6);
  fill.position.set(-100, 80, -140);
  scene.add(hemi, sun, sun.target, fill);

  const ATMOS = {
    plane: { top: '#426f9d', horizon: '#d9e4e9', bottom: '#9faeb9', sun: [0.4, 0.55, -0.7], sunColor: '#fff3e0', fog: '#c4d5e0', fogNear: 380, fogFar: 1900, hemi: ['#dceaff', '#9c9e9f', 0.6], dir: ['#fff1db', 3.1, [180, 240, -320]], exposure: 0.9 },
    hotel: { top: '#6c8ca5', horizon: '#e6d3b6', bottom: '#9ba6ac', sun: [-0.5, 0.65, 0.6], sunColor: '#fff0d5', fog: '#c4c8c8', fogNear: 200, fogFar: 1400, hemi: ['#dce5ef', '#8f8271', 0.65], dir: ['#ffe8cb', 2.6, [-200, 280, 260]], exposure: 0.9 },
    office: { top: '#3f74bd', horizon: '#e9dfcc', bottom: '#8a9bab', sun: [0.5, 0.3, 0.8], sunColor: '#fff1d6', fog: '#d4dbe2', fogNear: 220, fogFar: 1500, hemi: ['#d6e6ff', '#8e8a7e', 0.45], dir: ['#fff3e0', 2.2, [250, 300, 380]], exposure: 0.95 },
  };
  function setAtmosphere(kind) {
    const a = kind === 'stadium' ? { ...ATMOS.office, fogNear: 650, fogFar: 2600, exposure: 0.9 } : kind === 'development' ? { ...ATMOS.office, fogNear: 650, fogFar: 2600, exposure: 0.9 } : ATMOS[kind] || ATMOS.office;
    const shadowSize = kind === 'development' ? 4096 : 2048;
    if (sun.shadow.mapSize.x !== shadowSize) {
      sun.shadow.mapSize.set(shadowSize, shadowSize);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    const u = sky.material.uniforms;
    u.top.value = rgb(a.top); u.horizon.value = rgb(a.horizon); u.bottom.value = rgb(a.bottom);
    u.sunDir.value.set(...a.sun).normalize(); u.sunColor.value = rgb(a.sunColor);
    scene.fog = new THREE.Fog(a.fog, a.fogNear, a.fogFar);
    hemi.color.set(a.hemi[0]); hemi.groundColor.set(a.hemi[1]); hemi.intensity = a.hemi[2];
    sun.color.set(a.dir[0]); sun.intensity = a.dir[1]; sun.position.set(...a.dir[2]);
    if (renderer) renderer.toneMappingExposure = a.exposure;
    refreshEnv();
  }
  function fitShadows(bounds) {
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.58, 15);
    const direction = sun.position.clone().normalize();
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(direction, radius * 3);
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: radius * 0.1, far: radius * 6 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }
  return { sky, setAtmosphere, fitShadows };
}
