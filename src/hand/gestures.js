/*
 * Hand gestures from MediaPipe hand landmarks (21 points per hand, normalized 0..1 video coordinates).
 * Pure functions and small state machines, no DOM or Three.js, so they can be unit-tested.
 *
 *   classify(landmarks)            → 'pinch' | 'fist' | 'point' | 'open' | 'other'
 *   createHandTracker()            → per-hand smoothing and pose debouncing
 *   createInteraction()            → turns one or two tracked hands into app events:
 *       hover · pinchStart / pinchMove / pinchEnd · rotate · zoom · explode · clap · flick
 */

// Landmark indices
const WRIST = 0, THUMB_TIP = 4, INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8, MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20], PIPS = [6, 10, 14, 18];

const d2 = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

/** Hand pose from one hand's landmarks. `aspect` is video width / height (landmarks are normalized per axis). */
export function classify(lm, aspect = 1, wasPinching = false) {
  const palm = d2(lm[WRIST], lm[MIDDLE_MCP], aspect) || 1e-6;
  const pinch = d2(lm[THUMB_TIP], lm[INDEX_TIP], aspect) / palm;
  if (pinch < (wasPinching ? 0.5 : 0.33)) return 'pinch';            // hysteresis: harder to start than to keep
  const extended = TIPS.map((t, i) => d2(lm[t], lm[WRIST], aspect) > d2(lm[PIPS[i]], lm[WRIST], aspect) * 1.12);
  const n = extended.filter(Boolean).length;
  if (n === 0) return 'fist';
  if (extended[0] && n === 1) return 'point';
  if (n === 4) return 'open';
  return 'other';
}

/* One Euro filter: smooth when still, responsive when moving fast (Casiez et al. 2012). */
export function oneEuro({ minCutoff = 1.4, beta = 0.02, dCutoff = 1 } = {}) {
  let x = null, dx = 0, t0 = 0;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return (value, t) => {
    if (x === null) { x = value; t0 = t; return x; }
    const dt = Math.max(1e-3, t - t0); t0 = t;
    const rawDx = (value - x) / dt;
    dx += alpha(dCutoff, dt) * (rawDx - dx);
    x += alpha(minCutoff + beta * Math.abs(dx), dt) * (value - x);
    return x;
  };
}

/** Smooths the points we steer with and debounces pose changes, per hand (keyed by handedness). */
export function createHandTracker({ aspect = 16 / 9, stableFrames = 2 } = {}) {
  const hands = new Map();
  const make = () => ({ pose: 'other', candidate: null, count: 0, f: Array.from({ length: 6 }, () => oneEuro()), lastSeen: 0 });
  return {
    setAspect(a) { aspect = a; },
    /** results: [{ side: 'Left'|'Right', landmarks }] → [{ side, pose, cursor, palm }] in normalized video coords (unmirrored) */
    update(results, t) {
      const out = [];
      const seen = new Set();
      for (const r of results) {
        let h = hands.get(r.side); if (!h) { h = make(); hands.set(r.side, h); }
        seen.add(r.side); h.lastSeen = t;
        const raw = classify(r.landmarks, aspect, h.pose === 'pinch');
        if (raw === h.pose) { h.candidate = null; h.count = 0; }
        else if (raw === h.candidate) { if (++h.count >= (raw === 'pinch' || h.pose === 'pinch' ? 1 : stableFrames)) { h.pose = raw; h.candidate = null; h.count = 0; } }
        else { h.candidate = raw; h.count = 1; if (raw === 'pinch' || h.pose === 'pinch') { h.pose = raw; h.candidate = null; h.count = 0; } }
        const lm = r.landmarks;
        // pinching: steer with the point between thumb and index, otherwise with the index tip
        const tip = h.pose === 'pinch' ? { x: (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2, y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2 } : lm[INDEX_TIP];
        const palmPt = { x: (lm[WRIST].x + lm[INDEX_MCP].x + lm[MIDDLE_MCP].x) / 3, y: (lm[WRIST].y + lm[INDEX_MCP].y + lm[MIDDLE_MCP].y) / 3 };
        out.push({
          side: r.side, pose: h.pose, landmarks: lm,
          cursor: { x: h.f[0](tip.x, t), y: h.f[1](tip.y, t) },
          palm: { x: h.f[2](palmPt.x, t), y: h.f[3](palmPt.y, t) },
          size: d2(lm[WRIST], lm[MIDDLE_MCP], aspect),
        });
      }
      for (const [side, h] of hands) if (!seen.has(side) && t - h.lastSeen > 0.4) hands.delete(side);
      return out;
    },
  };
}

/**
 * Turns tracked hands into interaction events. Times are seconds; positions are normalized video coords
 * already mirrored to match the screen (x grows to the right as the user sees it).
 */
export function createInteraction({ aspect = 16 / 9 } = {}) {
  let prev = null;                  // last frame's hands by side
  let pinchOwner = null;            // side holding a single-hand pinch
  let pinchAt = null;
  let lastClap = -10, apartSince = -10;
  let lastFlick = -10;
  const dist = (a, b) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);

  return {
    setAspect(a) { aspect = a; },
    update(hands, t) {
      const events = [];
      const by = Object.fromEntries(hands.map((h) => [h.side, h]));
      const two = hands.length === 2 ? hands : null;
      const primary = hands.find((h) => h.pose === 'pinch') || hands.find((h) => h.pose === 'point') || hands[0] || null;
      if (primary) events.push({ type: 'hover', x: primary.cursor.x, y: primary.cursor.y, pose: primary.pose, side: primary.side });

      // two-handed gestures take priority over one-handed ones
      let twoHanded = false;
      if (two) {
        const [a, b] = two, pa = prev?.[a.side], pb = prev?.[b.side];
        const dNow = dist(a.palm, b.palm);
        if (a.pose === 'fist' && b.pose === 'fist' && pa && pb && pa.pose === 'fist' && pb.pose === 'fist') {
          events.push({ type: 'explode', delta: (dNow - dist(pa.palm, pb.palm)) * 2.2 }); twoHanded = true;
        } else if (a.pose === 'pinch' && b.pose === 'pinch' && pa && pb && pa.pose === 'pinch' && pb.pose === 'pinch') {
          const before = dist(pa.cursor, pb.cursor), now = dist(a.cursor, b.cursor);
          if (before > 0.02) events.push({ type: 'zoom', factor: now / before });
          twoHanded = true;
        }
        if (a.pose === 'pinch' && b.pose === 'pinch') twoHanded = true;
        // clap: two open hands come together quickly after being apart
        if (a.pose !== 'fist' && b.pose !== 'fist') {
          if (dNow > 0.32) apartSince = t;
          if (dNow < 0.14 && t - apartSince < 1.2 && t - lastClap > 1.0) { events.push({ type: 'clap' }); lastClap = t; }
        }
      }

      if (twoHanded && pinchOwner) { events.push({ type: 'pinchEnd', x: pinchAt.x, y: pinchAt.y, cancelled: true }); pinchOwner = null; }

      if (!twoHanded) {
        // single-hand pinch: start, drag, release
        const pincher = hands.find((h) => h.pose === 'pinch');
        if (pinchOwner && (!by[pinchOwner] || by[pinchOwner].pose !== 'pinch')) {
          events.push({ type: 'pinchEnd', x: pinchAt.x, y: pinchAt.y }); pinchOwner = null;
        }
        if (!pinchOwner && pincher) { pinchOwner = pincher.side; pinchAt = { ...pincher.cursor }; events.push({ type: 'pinchStart', x: pinchAt.x, y: pinchAt.y }); }
        else if (pinchOwner) { pinchAt = { ...by[pinchOwner].cursor }; events.push({ type: 'pinchMove', x: pinchAt.x, y: pinchAt.y }); }

        // one fist moving: rotate
        const fists = hands.filter((h) => h.pose === 'fist');
        if (fists.length === 1 && prev?.[fists[0].side]?.pose === 'fist') {
          const p0 = prev[fists[0].side].palm, p1 = fists[0].palm;
          events.push({ type: 'rotate', dx: p1.x - p0.x, dy: p1.y - p0.y });
        }
        // point and flick: a fast sideways index tip spins the model
        for (const h of hands) {
          const p = prev?.[h.side];
          if (h.pose !== 'point' || !p || p.pose !== 'point' || !(t > p.t)) continue;
          const vx = (h.cursor.x - p.cursor.x) / (t - p.t);
          if (Math.abs(vx) > 1.6 && t - lastFlick > 0.45) { events.push({ type: 'flick', v: vx }); lastFlick = t; }
        }
      }
      prev = Object.fromEntries(hands.map((h) => [h.side, { pose: h.pose, palm: { ...h.palm }, cursor: { ...h.cursor }, t }]));
      return events;
    },
  };
}
