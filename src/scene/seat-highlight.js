import * as THREE from 'three';

// Copy only the hovered instance into a small overlay, leaving shared seat materials intact.
export function createSeatHighlight(scene) {
  const group = new THREE.Group(); group.name = 'Seat hover highlight'; group.visible = false; scene.add(group);
  const fill = new THREE.MeshBasicMaterial({ color: '#ffcc70', transparent: true, opacity: 0.46, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const edge = new THREE.LineBasicMaterial({ color: '#fff1b8', transparent: true, opacity: 0.95, depthWrite: false });
  let key = '';
  function clear() {
    for (const child of group.children) if (child.isLineSegments) child.geometry.dispose();
    group.clear(); group.visible = false; group.userData = {}; key = '';
  }
  function show(hit) {
    if (!hit) { if (key) clear(); return; }
    const next = `${hit.object.userData.seatParts?.[0].uuid || hit.object.uuid}:${hit.instanceId}`;
    if (key === next) return;
    clear(); key = next;
    const parts = hit.object.userData.seatParts || [hit.object];
    for (const [index, source] of parts.entries()) {
      const matrix = new THREE.Matrix4(); source.getMatrixAt(hit.instanceId, matrix); matrix.premultiply(source.matrixWorld);
      const mesh = new THREE.Mesh(source.geometry, fill); mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.renderOrder = 5;
      mesh.raycast = () => {}; group.add(mesh);
      if (index === 0) {
        const outline = new THREE.LineSegments(new THREE.EdgesGeometry(source.geometry, 35), edge);
        outline.matrixAutoUpdate = false; outline.matrix.copy(matrix); outline.renderOrder = 6; outline.raycast = () => {}; group.add(outline);
      }
    }
    group.userData.zone = hit.object.userData.zone; group.userData.instanceId = hit.instanceId;
    group.visible = true;
  }
  return { show, clear, group };
}
