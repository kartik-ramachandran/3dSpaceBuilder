import * as THREE from 'three';

// Keep wheel/trackpad input independent of frame rate and stop at solid surfaces.
// OrbitControls still handles dragging, middle-button dolly and touch gestures.
export function createNavigation(camera, controls, canvas, interruptCamera) {
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const forward = new THREE.Vector3(), direction = new THREE.Vector3();
  const previous = new THREE.Vector3(), candidate = new THREE.Vector3();
  const previousTarget = new THREE.Vector3(), previousRotation = new THREE.Quaternion();
  const bounds = new THREE.Box3();
  let solids = [], pending = 0, lastWheel = -Infinity, active = false;
  const clearance = 0.55;
  controls.minDistance = 0.8;
  controls.zoomSpeed = 0.6;

  function stop() {
    pending = 0;
    controls.autoRotate = false;
    interruptCamera();
  }
  controls.addEventListener('start', stop);
  controls.addEventListener('end', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', () => { pending = 0; });
  canvas.addEventListener('keydown', (event) => {
    if (controls.enabled && event.key.startsWith('Arrow')) stop();
  }, { capture: true });

  function remember() {
    previous.copy(camera.position); previousTarget.copy(controls.target); previousRotation.copy(camera.quaternion);
  }

  function firstSurface(origin, heading, far = Infinity) {
    ray.set(origin, heading); ray.near = 0.001; ray.far = far;
    return ray.intersectObjects(solids, false).find((hit) => {
      for (let o = hit.object; o; o = o.parent) if (!o.visible) return false;
      const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
      return material.visible && (!material.transparent || material.opacity >= 0.98);
    });
  }

  canvas.addEventListener('wheel', (event) => {
    if (!controls.enabled || !controls.enableZoom) return;
    // Capture before OrbitControls so the same wheel event cannot dolly twice.
    event.preventDefault(); event.stopImmediatePropagation();
    controls.autoRotate = false;
    interruptCamera();
    const rect = canvas.getBoundingClientRect();
    const nextPointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    const newGesture = performance.now() - lastWheel > 220 || nextPointer.distanceTo(pointer) > 0.12;
    pointer.copy(nextPointer);
    camera.updateMatrixWorld();
    ray.setFromCamera(pointer, camera);
    direction.copy(ray.ray.direction);
    if (newGesture) {
      // Focus at the surface under the pointer without turning the camera.
      const hit = firstSurface(camera.position, direction);
      if (hit && bounds.containsPoint(hit.point)) {
        camera.getWorldDirection(forward);
        const distance = Math.max(controls.minDistance, hit.point.clone().sub(camera.position).dot(forward));
        controls.target.copy(camera.position).addScaledVector(forward, Math.min(distance, controls.maxDistance));
      }
    }
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    const delta = THREE.MathUtils.clamp(event.deltaY * units, -120, 120);
    if (Math.sign(delta) !== Math.sign(pending)) pending = 0;
    pending = THREE.MathUtils.clamp(pending + delta, -360, 360);
    lastWheel = performance.now();
  }, { capture: true, passive: false });

  return {
    move(horizontal, vertical, dt) {
      if (!controls.enabled || !controls.enablePan) return;
      if (!active) { remember(); active = true; }
      stop();
      camera.updateMatrixWorld();
      const scale = 2 * controls.getDistance() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / canvas.clientHeight;
      const amount = 180 * Math.min(dt, 0.05) * scale;
      const shift = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(horizontal * amount);
      shift.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), vertical * amount);
      camera.position.add(shift); controls.target.add(shift);
    },
    configure(world, overviewDistance) {
      stop();
      bounds.copy(world.fitBox).expandByScalar(2);
      controls.maxDistance = Math.max(overviewDistance * 3, 100);
      solids = [];
      world.group.traverse((obj) => {
        if (!obj.isMesh) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        if (materials.some((m) => m.visible && !m.transparent)) solids.push(obj);
      });
      world.group.updateMatrixWorld(true);
      remember();
    },
    reset() { pending = 0; active = false; remember(); },
    update(dt, interactive) {
      if (!interactive) { pending = 0; active = false; return; }
      if (!active) { remember(); active = true; }
      if (Math.abs(pending) > 0.05) {
        // Consume input once; do not keep dollying after scrolling has stopped.
        const delta = pending;
        pending = 0;
        camera.getWorldDirection(forward);
        const distance = camera.position.distanceTo(controls.target);
        const next = THREE.MathUtils.clamp(distance * Math.exp(delta * 0.0018), controls.minDistance, controls.maxDistance);
        const travel = distance - next;
        camera.position.addScaledVector(direction, travel);
        controls.target.copy(camera.position).addScaledVector(forward, next);
      }
      controls.update(dt);
      // Also protect pinch and middle-button dolly, not just wheel input.
      const movement = candidate.copy(camera.position).sub(previous);
      const length = movement.length();
      if (length > 0.00001) {
        const heading = movement.clone().divideScalar(length);
        const hit = firstSurface(previous, heading, length + clearance);
        if (hit) {
          const turning = camera.quaternion.angleTo(previousRotation) > 0.00001;
          if (turning) {
            // Reject blocked rotation without dragging the orbit pivot into a wall.
            camera.position.copy(previous); controls.target.copy(previousTarget); camera.quaternion.copy(previousRotation);
          } else {
            const allowed = Math.max(0, hit.distance - clearance);
            candidate.copy(previous).addScaledVector(heading, Math.min(length, allowed));
            // Panning/zooming translates the eye and target together, with no tilt.
            controls.target.add(candidate.clone().sub(camera.position));
            camera.position.copy(candidate);
          }
          camera.updateMatrixWorld();
          pending = 0;
        }
      }
      remember();
    },
  };
}
