/*
 * Hand mode: the apartment development as a hologram over the webcam, driven by hand gestures
 * (MediaPipe Hand Landmarker, on-device) with mouse and keyboard fallbacks.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { normalize, PRESETS } from '../spec/schema.js';
import { buildValuations } from '../spec/valuations.js';
import { buildHologram, HOLO } from './hologram.js';
import { createHandTracker, createInteraction } from './gestures.js';

const MP_VERSION = '1.2.3';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const HAND_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- data ---------- */
const spec = normalize(PRESETS.development);
const data = buildValuations(spec);
const fmt = (v) => { try { return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: spec.currency, currencyDisplay: 'code', maximumFractionDigits: 0 }).format(v).replace(/ /g, ' '); } catch (e) { return `${spec.currency} ${Math.round(v)}`; } };
$('#name').textContent = spec.name;
$('#lo').textContent = `${fmt(data.min)} /m²`; $('#hi').textContent = `${fmt(data.max)} /m²`;

/* ---------- renderer, background video pass, hologram scene, bloom ---------- */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));   // lighter: the hologram doesn't need retina resolution
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const video = $('#cam');
const videoTex = new THREE.VideoTexture(video); videoTex.colorSpace = THREE.SRGBColorSpace;
const bgScene = new THREE.Scene(), bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const bgMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: videoTex }, hasVideo: { value: 0 }, videoAspect: { value: 16 / 9 }, screenAspect: { value: 1 }, mirror: { value: 1 }, dim: { value: 0.4 }, gray: { value: 0 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D map; uniform float hasVideo, videoAspect, screenAspect, mirror, dim, gray, time; varying vec2 vUv;
    void main(){
      vec2 uv = vUv; float r = screenAspect / videoAspect;
      if (r > 1.0) uv.y = (uv.y - 0.5) / r + 0.5; else uv.x = (uv.x - 0.5) * r + 0.5;
      if (mirror > 0.5) uv.x = 1.0 - uv.x;
      vec3 c;
      if (hasVideo > 0.5) c = texture2D(map, uv).rgb;
      else { float v = 1.0 - length(vUv - vec2(0.5, 0.42)) * 1.1; c = mix(vec3(0.01, 0.025, 0.045), vec3(0.03, 0.09, 0.14), clamp(v, 0.0, 1.0)); }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(l), gray);
      c *= 1.0 - dim;
      c += vec3(0.0, 0.02, 0.03) * (0.5 + 0.5 * sin(vUv.y * 900.0 + time * 3.0)) * 0.35;  // faint scanlines
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
camera.position.set(0, 1.55, 3.3); camera.lookAt(0, 0.35, 0);
const holo = buildHologram(spec, data);
$('#meta').textContent = `${holo.units.size} apartments · ${spec.shell.buildings} buildings · ${spec.shell.floors} floors`;   // the low-rise buildings shown in the hologram
const turntable = new THREE.Group(); turntable.add(holo.root); scene.add(turntable);
turntable.position.y = 0.05;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(bgScene, bgCam));
const main = new RenderPass(scene, camera); main.clear = false; composer.addPass(main);
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.45, 0.62); composer.addPass(bloom);
{ const setSize = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => setSize(w / 2, h / 2); }   // glow at half resolution
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h);
  camera.aspect = w / h; camera.fov = w / h < 0.9 ? 58 : 42; camera.updateProjectionMatrix();
  bgMat.uniforms.screenAspect.value = w / h;
  const dbg = $('#handDebug'); dbg.width = w * devicePixelRatio; dbg.height = h * devicePixelRatio; dbg.style.width = `${w}px`; dbg.style.height = `${h}px`;
}
addEventListener('resize', resize); resize();

/* ---------- view state ---------- */
const view = { driveUntil: 0, rotY: -0.5, rotX: 0.32, zoom: 1, spin: 0, explode: 0, explodeTarget: null, mirror: true, gray: false, dim: 0.4, debug: false };
let hovered = null, selected = null;
function paint() {
  for (const [id] of holo.units) {
    if (id === selected) holo.setUnitColor(id, HOLO.pick);
    else if (id === hovered) holo.setUnitColor(id, HOLO.hover);
    else holo.resetColor(id);
  }
}
function setHovered(id) { if (id !== hovered) { hovered = id; paint(); } }
function select(id) {
  selected = id; paint();
  const card = $('#card');
  if (!id) { card.classList.add('off'); return; }
  const u = holo.units.get(id), z = u.zone, e = data.byZone.get(id), l = e.latest;
  $('#cKind').textContent = `Apartment · confidence ${e.confidence}`;
  $('#cName').textContent = z.name;
  $('#cSub').textContent = `Building ${String.fromCharCode(64 + z.building)} · Level ${z.floor} · ${z.bedrooms} bed · ${z.area} m²`;
  $('#cFigs').innerHTML = l ? `<div><b>${fmt(l.value)}</b><small>latest · ${l.quarter}</small></div><div><b>${fmt(l.rate)}</b><small>per m²</small></div>` : `<div style="grid-column:span 2"><b>No market valuation</b><small>example value ${fmt(z.price)}</small></div>`;
  $('#cHist').innerHTML = e.valuations.slice().reverse().map((v) => `<tr><td>${v.quarter}</td><td>${v.purpose}</td><td>${fmt(v.value)}</td></tr>`).join('');
  card.classList.remove('off');
}
function toast(msg, ms = 1600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('off'); clearTimeout(toast.tm); toast.tm = setTimeout(() => t.classList.add('off'), ms); }
function assemble() { view.explodeTarget = 0; holo.clearPulls(); toast('Assembled'); }

/* ---------- picking ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function unitAt(sx, sy) {
  ndc.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(holo.pickables, false)[0];
  return hit ? hit.object.userData.zone : null;
}
/** Normalized video coords (already mirrored as displayed) → screen pixels, matching the cover-fit background. */
function toScreen(p) {
  const r = (innerWidth / innerHeight) / bgMat.uniforms.videoAspect.value;
  let x = p.x, y = p.y;
  if (r > 1) y = (y - 0.5) * r + 0.5; else x = (x - 0.5) / r + 0.5;
  return { x: x * innerWidth, y: y * innerHeight };
}

/* ---------- floor pulling ---------- */
let grab = null;   // { id, group, start: {x,y}, pull0: Vector3, moved }
const tmpQ = new THREE.Quaternion();
function localRight() {   // camera's screen-right direction expressed in the model's local frame
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  holo.model.getWorldQuaternion(tmpQ); return v.applyQuaternion(tmpQ.invert()).setY(0).normalize();
}
function localUp() {
  const v = new THREE.Vector3(0, 0, -1);
  holo.model.getWorldQuaternion(tmpQ); return v.applyQuaternion(tmpQ.invert()).setY(0).normalize();
}
function startPress(sx, sy) {
  const id = unitAt(sx, sy);
  if (!id) { grab = { id: null, start: { x: sx, y: sy }, moved: false }; return; }
  const group = holo.units.get(id).group;
  grab = { id, group, start: { x: sx, y: sy }, pull0: group.userData.pullTarget.clone(), moved: false, right: localRight(), depth: localUp() };
}
function movePress(sx, sy) {
  if (!grab) return;
  const dx = sx - grab.start.x, dy = sy - grab.start.y;
  if (Math.hypot(dx, dy) > 18) grab.moved = true;
  if (grab.id && view.explode > 0.25 && grab.moved) {
    const k = 1 / holo.scale / innerWidth * 2.6 / view.zoom;   // screen px → model units
    grab.group.userData.pullTarget.copy(grab.pull0).addScaledVector(grab.right, dx * k).addScaledVector(grab.depth, -dy * k);
  }
}
function endPress() {
  if (!grab) return;
  if (!grab.moved) select(grab.id);
  else if (grab.id && view.explode > 0.25) toast(`Level ${holo.units.get(grab.id).zone.floor} of Building ${String.fromCharCode(64 + holo.units.get(grab.id).zone.building)} pulled out`);
  grab = null;
}

/* ---------- mouse and keyboard fallback ---------- */
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const onUnit = unitAt(e.clientX, e.clientY);
  if (e.shiftKey || (onUnit && view.explode > 0.25)) startPress(e.clientX, e.clientY);
  drag = { x: e.clientX, y: e.clientY, moved: false, press: !!grab };
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) { setHovered(unitAt(e.clientX, e.clientY)); return; }
  if (drag.press) { movePress(e.clientX, e.clientY); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
  view.rotY += dx * 0.006; view.rotX = clamp(view.rotX + dy * 0.004, -0.1, 1.2);
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (drag?.press) endPress();
  else if (drag && !drag.moved) select(unitAt(e.clientX, e.clientY));
  drag = null;
});
canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 3); }, { passive: false });
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input')) return;
  const k = e.key.toLowerCase();
  if (k === 'e') { view.explodeTarget = view.explode > 0.5 ? 0 : 1; toast(view.explodeTarget ? 'Exploded' : 'Assembled'); }
  if (k === 'a') assemble();
  if (k === 'm') setMirror(!view.mirror);
  if (k === 'b') setGray(!view.gray);
  if (k === 'c') nextCamera();
  if (k === 'd') { view.debug = !view.debug; toast(`Debug ${view.debug ? 'on' : 'off'}`); }
  if (k === 'escape') select(null);
});

/* ---------- toggles ---------- */
function setMirror(on) { view.mirror = on; bgMat.uniforms.mirror.value = on ? 1 : 0; $('#tMirror b').textContent = on ? 'On' : 'Off'; }
function setGray(on) { view.gray = on; bgMat.uniforms.gray.value = on ? 1 : 0; $('#tBW b').textContent = on ? 'On' : 'Off'; }
$('#tMirror').addEventListener('click', () => setMirror(!view.mirror));
$('#tBW').addEventListener('click', () => setGray(!view.gray));
$('#tCam').addEventListener('click', () => nextCamera());
$('#tDim').addEventListener('input', (e) => { view.dim = e.target.value / 100; bgMat.uniforms.dim.value = view.dim; $('#tDimV').textContent = `${e.target.value}%`; });

/* ---------- camera + hand tracking ---------- */
let landmarker = null, stream = null, cameras = [], camIndex = 0, lastVideoTime = -1;
const tracker = createHandTracker(), interaction = createInteraction();
async function openCamera(deviceId) {
  stream?.getTracks().forEach((t) => t.stop());
  // 640x480 is plenty for hand tracking and lets most webcams deliver 60 fps
  const size = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } };
  stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: 'user', ...size }, audio: false });
  video.srcObject = stream; await video.play();
  const aspect = (video.videoWidth || 16) / (video.videoHeight || 9);
  bgMat.uniforms.videoAspect.value = aspect; bgMat.uniforms.hasVideo.value = 1;
  tracker.setAspect(aspect); interaction.setAspect(aspect);
  cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const track = stream.getVideoTracks()[0];
  camIndex = Math.max(0, cameras.findIndex((c) => c.deviceId === track.getSettings().deviceId));
  $('#tCam b').textContent = (track.label || 'Camera').replace(/\s*\(.*\)$/, '').slice(0, 22);
  scheduleTracking();
}
async function nextCamera() {
  if (cameras.length < 2) { toast(cameras.length ? 'Only one camera found' : 'Camera is off'); return; }
  camIndex = (camIndex + 1) % cameras.length;
  try { await openCamera(cameras[camIndex].deviceId); toast(`Camera: ${$('#tCam b').textContent}`); } catch (e) { toast('Could not switch camera'); }
}
async function startTracking() {
  $('#stTrack').textContent = 'Loading';
  const { FilesetResolver, HandLandmarker } = await import(`${MP_URL}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
  const opts = (delegate) => ({ baseOptions: { modelAssetPath: HAND_MODEL, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5 });
  let lm;
  try { lm = await HandLandmarker.createFromOptions(files, opts('GPU')); }
  catch (e) { lm = await HandLandmarker.createFromOptions(files, opts('CPU')); }
  // The first detection compiles GPU shaders and can stall for seconds. Do it now, on a blank frame,
  // while the status still says "Warming up", rather than freezing the page on the user's first gesture.
  $('#stTrack').textContent = 'Warming up';
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  const blank = document.createElement('canvas'); blank.width = 64; blank.height = 48;
  blank.getContext('2d').fillRect(0, 0, 64, 48);
  lm.detectForVideo(blank, performance.now());
  landmarker = lm;
  $('#stTrack').textContent = 'On';
}
$('#goCam').addEventListener('click', async () => {
  const err = $('#startErr'); err.hidden = true;
  $('#goCam').textContent = 'Starting…'; $('#goCam').disabled = true;
  try {
    await openCamera();
    $('#start').hidden = true;
    toast('Camera on. Loading hand tracking…', 2500);
    startTracking().then(() => toast('Hands ready: pinch an apartment', 2400)).catch((e) => { console.warn(e); $('#stTrack').textContent = 'Failed'; toast('Hand tracking could not load. Mouse and keys still work.', 3500); });
  } catch (e) {
    console.warn(e);
    err.textContent = e.name === 'NotAllowedError' ? 'Camera permission was declined. Allow it in the address bar, or use the mouse.' : 'No camera could be opened. You can still use the mouse.';
    err.hidden = false; $('#goCam').textContent = 'Start camera'; $('#goCam').disabled = false;
  }
});
$('#goMouse').addEventListener('click', () => { $('#start').hidden = true; $('#stTrack').textContent = 'Mouse'; canvas.focus(); });

/* ---------- tracking loop: runs on every new camera frame, not tied to rendering ---------- */
const perf = { calls: 0, camFrames: 0, camFps: 0, trackMs: 0, renderFps: 0, since: performance.now() };
let trackLoop = 0, polling = false;
function scheduleTracking() {
  const gen = ++trackLoop;
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) { polling = true; return; }   // fallback: poll from the render loop
  const onFrame = () => { if (gen !== trackLoop) return; perf.camFrames++; handleHands(performance.now() / 1000); video.requestVideoFrameCallback(onFrame); };
  video.requestVideoFrameCallback(onFrame);
}
function updatePerf(now) {
  if (now - perf.since < 500) return;
  perf.camFps = perf.camFrames * 1000 / (now - perf.since); perf.camFrames = 0; perf.since = now;
  $('#stCam').textContent = stream ? `${Math.round(perf.camFps)} fps` : '—';
  $('#stTrackMs').textContent = landmarker ? `${perf.trackMs.toFixed(1)} ms` : '—';
  $('#stRender').textContent = `${Math.round(perf.renderFps)} fps`;
  const slow = stream && perf.camFps < 24 ? 'Camera is slow: add light' : perf.trackMs > 30 ? 'Tracking is slow' : perf.renderFps && perf.renderFps < 40 ? 'Rendering is slow' : '';
  $('#stHint').textContent = slow; $('#stHint').hidden = !slow;
}

/* ---------- applying gestures ---------- */
const rets = [$('#ret0'), $('#ret1')];
const POSE_LABEL = { pinch: 'Pinch', fist: 'Fist', point: 'Point', open: 'Open', other: '' };
function handleHands(t) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const t0 = performance.now();
  const res = landmarker.detectForVideo(video, t0);
  if (++perf.calls > 5) perf.trackMs += (performance.now() - t0 - perf.trackMs) * 0.15;   // skip the first calls: model warm-up
  else perf.trackMs = performance.now() - t0;
  const raw = (res.landmarks || []).map((lm, i) => ({ side: res.handedness?.[i]?.[0]?.categoryName || `H${i}`, landmarks: lm }));
  const tracked = tracker.update(raw, t);
  // mirror to match what the user sees
  const hands = tracked.map((h) => view.mirror ? { ...h, cursor: { x: 1 - h.cursor.x, y: h.cursor.y }, palm: { x: 1 - h.palm.x, y: h.palm.y } } : h);
  rets.forEach((r, i) => {
    const h = hands[i];
    if (!h) { r.classList.remove('on'); return; }
    const p = toScreen(h.cursor);
    r.classList.add('on'); r.dataset.pose = h.pose;
    r.style.transform = `translate(${p.x}px, ${p.y}px)`; r.querySelector('.lbl').textContent = POSE_LABEL[h.pose];
  });
  $('#stHands').textContent = String(hands.length);
  $('#stGesture').textContent = hands.map((h) => POSE_LABEL[h.pose] || '·').join(' + ') || '—';
  if (view.debug) drawDebug(tracked); else clearDebug();

  for (const ev of interaction.update(hands, t)) {
    const p = ev.x !== undefined ? toScreen(ev) : null;
    if (ev.type === 'hover' && !grab) setHovered(unitAt(p.x, p.y));
    if (ev.type === 'pinchStart') startPress(p.x, p.y);
    if (ev.type === 'pinchMove') { movePress(p.x, p.y); if (grab?.moved) view.driveUntil = t + 0.25; }
    if (ev.type === 'pinchEnd') { if (ev.cancelled) grab = null; else endPress(); }
    if (ev.type === 'rotate' || ev.type === 'zoom' || ev.type === 'explode') view.driveUntil = t + 0.25;
    if (ev.type === 'rotate') { view.rotY += ev.dx * 5.5; view.rotX = clamp(view.rotX + ev.dy * 3, -0.1, 1.2); }
    if (ev.type === 'zoom') view.zoom = clamp(view.zoom * ev.factor, 0.5, 3);
    if (ev.type === 'explode') { view.explodeTarget = null; view.explode = clamp(view.explode + ev.delta, 0, 1); }
    if (ev.type === 'clap') assemble();
    if (ev.type === 'flick') view.spin += ev.v * 1.6;
  }
}
function clearDebug() { const c = $('#handDebug'); if (c.dataset.drawn) { c.getContext('2d').clearRect(0, 0, c.width, c.height); delete c.dataset.drawn; } }
function drawDebug(hands) {
  const c = $('#handDebug'), g = c.getContext('2d'); c.dataset.drawn = '1';
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
  const bones = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
  for (const h of hands) {
    const pts = h.landmarks.map((p) => toScreen({ x: view.mirror ? 1 - p.x : p.x, y: p.y }));
    g.strokeStyle = 'rgba(127,230,255,.8)'; g.lineWidth = 2;
    for (const [a, b] of bones) { g.beginPath(); g.moveTo(pts[a].x, pts[a].y); g.lineTo(pts[b].x, pts[b].y); g.stroke(); }
    g.fillStyle = '#ffd23f'; for (const p of pts) { g.beginPath(); g.arc(p.x, p.y, 3, 0, 7); g.fill(); }
  }
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, now = performance.now();
  if (polling) handleHands(now / 1000);
  if (dt > 0) perf.renderFps += (1 / dt - perf.renderFps) * 0.1;
  updatePerf(now);
  if (view.explodeTarget !== null) { view.explode += (view.explodeTarget - view.explode) * (1 - Math.exp(-dt * (reduceMotion ? 30 : 5))); if (Math.abs(view.explode - view.explodeTarget) < 0.002) { view.explode = view.explodeTarget; view.explodeTarget = null; } }
  view.rotY += view.spin * dt; view.spin *= Math.exp(-dt * 1.8);
  turntable.rotation.set(view.rotX, view.rotY, 0, 'XYZ');
  turntable.scale.setScalar(view.zoom);
  holo.setExplode(view.explode); holo.update(dt, t, now / 1000 < view.driveUntil);   // 1:1 while hands drive, eased otherwise
  $('#stExplode').textContent = `${Math.round(view.explode * 100)}%`;
  bgMat.uniforms.time.value = t;
  composer.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
