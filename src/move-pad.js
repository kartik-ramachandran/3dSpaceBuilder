/* A spring-centred analog pad. No momentum and no movement after release. */
export function createMovePad(element, move) {
  const knob = element.querySelector('.move-knob');
  const heldKeys = new Set();
  let pointerId = null, x = 0, y = 0;
  function draw() {
    knob.style.transform = `translate(${x * 24}px, ${-y * 24}px)`;
    element.classList.toggle('active', Boolean(x || y));
  }
  function stop() { pointerId = null; heldKeys.clear(); x = y = 0; draw(); }
  function point(event) {
    const rect = element.getBoundingClientRect(), radius = rect.width * 0.32;
    x = (event.clientX - rect.left - rect.width / 2) / radius;
    y = -(event.clientY - rect.top - rect.height / 2) / radius;
    const length = Math.hypot(x, y);
    if (length < 0.12) x = y = 0;
    else if (length > 1) { x /= length; y /= length; }
    draw();
  }
  element.addEventListener('pointerdown', (event) => {
    if (pointerId !== null || event.button !== 0) return;
    event.preventDefault(); element.focus({ preventScroll: true });
    pointerId = event.pointerId; element.setPointerCapture(pointerId); point(event);
  });
  element.addEventListener('pointermove', (event) => { if (event.pointerId === pointerId) point(event); });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(name, (event) => {
    if (event.pointerId === pointerId) stop();
  });
  function keys() {
    x = Number(heldKeys.has('ArrowRight')) - Number(heldKeys.has('ArrowLeft'));
    y = Number(heldKeys.has('ArrowUp')) - Number(heldKeys.has('ArrowDown'));
    const length = Math.hypot(x, y); if (length > 1) { x /= length; y /= length; } draw();
  }
  element.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); heldKeys.add(event.key); keys();
  });
  element.addEventListener('keyup', (event) => { if (heldKeys.delete(event.key)) { event.preventDefault(); keys(); } });
  element.addEventListener('blur', stop);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  return { stop, update(dt) { if (x || y) move(x, y, dt); } };
}
