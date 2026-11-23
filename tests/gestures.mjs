// Gesture logic for hand mode, tested with synthetic MediaPipe-style landmarks (no camera, no browser).
import assert from 'node:assert/strict';
import { classify, createHandTracker, createInteraction } from '../src/hand/gestures.js';

/** A plausible 21-point hand centred at (cx, cy), fingers up, in a given pose. */
function hand(cx, cy, pose) {
  const P = (x, y) => ({ x, y, z: 0 });
  const lm = new Array(21);
  lm[0] = P(cx, cy + 0.12);
  lm[1] = P(cx - 0.03, cy + 0.09); lm[2] = P(cx - 0.05, cy + 0.06); lm[3] = P(cx - 0.06, cy + 0.03); lm[4] = P(cx - 0.07, cy);
  const up = pose === 'open' ? [1, 1, 1, 1] : pose === 'point' ? [1, 0, 0, 0] : pose === 'pinch' ? [1, 1, 1, 1] : [0, 0, 0, 0];
  for (let f = 0; f < 4; f++) {
    const x = cx - 0.03 + f * 0.02, b = 5 + f * 4;
    lm[b] = P(x, cy + 0.03);
    if (up[f]) { lm[b + 1] = P(x, cy - 0.01); lm[b + 2] = P(x, cy - 0.04); lm[b + 3] = P(x, cy - 0.07); }
    else { lm[b + 1] = P(x, cy - 0.005); lm[b + 2] = P(x, cy + 0.02); lm[b + 3] = P(x, cy + 0.04); }
  }
  if (pose === 'pinch') lm[4] = P(lm[8].x + 0.004, lm[8].y + 0.004);
  return lm;
}

for (const pose of ['open', 'fist', 'point', 'pinch']) assert.equal(classify(hand(0.5, 0.5, pose)), pose, `classifies ${pose}`);

// Tracker: pose changes need two frames, except entering or leaving a pinch, which is immediate.
{
  const tr = createHandTracker({ aspect: 1 });
  const f = (pose, t) => tr.update([{ side: 'Right', landmarks: hand(0.5, 0.5, pose) }], t)[0].pose;
  assert.equal(f('open', 0), 'other', 'first frame starts as other until confirmed');
  assert.equal(f('open', 0.03), 'open');
  assert.equal(f('fist', 0.06), 'open', 'a one-frame fist is ignored');
  assert.equal(f('fist', 0.09), 'fist', 'a held fist is accepted');
  assert.equal(f('pinch', 0.12), 'pinch', 'pinch starts immediately');
  assert.equal(f('open', 0.15), 'open', 'pinch releases immediately');
}

// Interaction events from already-tracked hands.
const H = (side, pose, x, y) => ({ side, pose, cursor: { x, y }, palm: { x, y: y + 0.05 } });
{
  const ix = createInteraction({ aspect: 1 });
  const types = (hs, t) => ix.update(hs, t).map((e) => e.type);
  assert.deepEqual(types([H('Right', 'open', 0.5, 0.5)], 0), ['hover']);
  assert.ok(types([H('Right', 'pinch', 0.5, 0.5)], 0.1).includes('pinchStart'));
  assert.ok(types([H('Right', 'pinch', 0.55, 0.5)], 0.2).includes('pinchMove'));
  assert.ok(types([H('Right', 'open', 0.55, 0.5)], 0.3).includes('pinchEnd'));
}
{
  const ix = createInteraction({ aspect: 1 });
  ix.update([H('Right', 'fist', 0.5, 0.5)], 0);
  const rot = ix.update([H('Right', 'fist', 0.56, 0.48)], 0.05).find((e) => e.type === 'rotate');
  assert.ok(rot && rot.dx > 0.05 && rot.dy < 0, 'one moving fist rotates');
}
{
  const ix = createInteraction({ aspect: 1 });
  ix.update([H('Left', 'fist', 0.4, 0.5), H('Right', 'fist', 0.6, 0.5)], 0);
  const ev = ix.update([H('Left', 'fist', 0.3, 0.5), H('Right', 'fist', 0.7, 0.5)], 0.05);
  const ex = ev.find((e) => e.type === 'explode');
  assert.ok(ex && ex.delta > 0, 'two fists pulled apart explode');
  assert.ok(!ev.some((e) => e.type === 'rotate'), 'and do not also rotate');
}
{
  const ix = createInteraction({ aspect: 1 });
  ix.update([H('Left', 'pinch', 0.4, 0.5), H('Right', 'pinch', 0.6, 0.5)], 0);
  const ev = ix.update([H('Left', 'pinch', 0.35, 0.5), H('Right', 'pinch', 0.65, 0.5)], 0.05);
  assert.ok(ev.find((e) => e.type === 'zoom').factor > 1, 'two pinches spreading zoom in');
  assert.ok(!ev.some((e) => e.type === 'pinchStart'), 'a two-hand pinch is not a selection');
}
{
  const ix = createInteraction({ aspect: 1 });
  ix.update([H('Left', 'open', 0.2, 0.5), H('Right', 'open', 0.8, 0.5)], 0);
  const ev = ix.update([H('Left', 'open', 0.47, 0.5), H('Right', 'open', 0.53, 0.5)], 0.3);
  assert.ok(ev.some((e) => e.type === 'clap'), 'palms coming together clap');
  ix.update([H('Left', 'open', 0.2, 0.5), H('Right', 'open', 0.8, 0.5)], 0.5);
  assert.ok(!ix.update([H('Left', 'open', 0.47, 0.5), H('Right', 'open', 0.53, 0.5)], 0.7).some((e) => e.type === 'clap'), 'clap has a cooldown');
}
{
  const ix = createInteraction({ aspect: 1 });
  ix.update([H('Right', 'point', 0.4, 0.5)], 0);
  const fl = ix.update([H('Right', 'point', 0.5, 0.5)], 0.04).find((e) => e.type === 'flick');
  assert.ok(fl && fl.v > 0, 'a fast pointing finger flicks');
  ix.update([H('Right', 'point', 0.6, 0.5)], 1);
  assert.ok(!ix.update([H('Right', 'point', 0.61, 0.5)], 1.1).some((e) => e.type === 'flick'), 'a slow finger does not');
}
console.log('ok: gestures — poses, debouncing, pinch select, rotate, explode, zoom, clap, flick');
