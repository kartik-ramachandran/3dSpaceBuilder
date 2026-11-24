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

// Tracker: poses are accepted on their first frame (hysteresis in classify prevents flicker).
{
  const tr = createHandTracker({ aspect: 1 });
  const f = (pose, t) => tr.update([{ side: 'Right', landmarks: hand(0.5, 0.5, pose) }], t)[0].pose;
  assert.equal(f('open', 0), 'open', 'first frame is accepted');
  assert.equal(f('fist', 0.033), 'fist', 'a fist is accepted immediately');
  assert.equal(f('pinch', 0.066), 'pinch', 'pinch starts immediately');
  assert.equal(f('open', 0.1), 'open', 'pinch releases immediately');
}
// Hysteresis: a half-curled hand stays in whichever pose it was already in.
{
  const half = hand(0.5, 0.5, 'fist');
  for (let f = 0; f < 4; f++) { const x = 0.47 + f * 0.02, b = 5 + f * 4; half[b + 1] = { x, y: 0.49, z: 0 }; half[b + 3] = { x, y: 0.465, z: 0 }; }   // tips just past the middle joints
  assert.equal(classify(half, 1, 'fist'), 'fist', 'a loosening fist stays a fist');
  assert.equal(classify(half, 1, 'open'), 'open', 'a relaxing open hand stays open');
}
// Smoothing follows fast moves closely and predicts slightly ahead.
{
  const tr = createHandTracker({ aspect: 1, lead: 0 }), tp = createHandTracker({ aspect: 1 });
  let lagged, unpredicted, predicted;
  for (let i = 0; i <= 15; i++) {   // index tip sweeping right at 1.5 units/s, 30 fps; each frame shows where the tip was ~40 ms ago
    const t = i / 30, x = 0.2 + 1.5 * t, tipNow = (x - 0.03) + 1.5 * 0.04;
    const a = tr.update([{ side: 'Right', landmarks: hand(x, 0.5, 'point') }], t)[0].cursor.x;
    const b = tp.update([{ side: 'Right', landmarks: hand(x, 0.5, 'point') }], t)[0].cursor.x;
    lagged = a - (x - 0.03); unpredicted = a - tipNow; predicted = b - tipNow;
  }
  assert.ok(Math.abs(lagged) < 0.03, `filter lag on a fast sweep is small (${lagged.toFixed(3)})`);
  assert.ok(Math.abs(predicted) < Math.abs(unpredicted), `prediction gets closer to where the hand is now (${predicted.toFixed(3)} vs ${unpredicted.toFixed(3)})`);
  const still = createHandTracker({ aspect: 1 }); let spread = [];
  for (let i = 0; i < 30; i++) spread.push(still.update([{ side: 'Right', landmarks: hand(0.5 + (i % 2 ? 0.004 : -0.004), 0.5, 'point') }], i / 30)[0].cursor.x);
  spread = spread.slice(10);
  assert.ok(Math.max(...spread) - Math.min(...spread) < 0.006, 'jitter on a still hand is damped');
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
