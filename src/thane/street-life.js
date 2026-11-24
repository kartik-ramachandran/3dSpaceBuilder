import * as THREE from 'three';
import { box, cyl, merge, std } from '../scene/helpers.js';
import { detailTraffic } from '../scene/residential-detail.js';
import { DEV } from '../spec/site-layout.js';
import { createRoadRoute } from './road-route.js';
import { rng } from '../util.js';

// Simulated footpath activity. Seven instanced batches, independent of crowd size.
export function createStreetLife(layout, route=createRoadRoute(layout)) {
  const group = new THREE.Group(); group.name = 'Simulated street life';
  const random = rng(210), count = 180, people = [];
  const batch = (geo, mat, n = count) => { const mesh = new THREE.InstancedMesh(geo, mat, n); mesh.frustumCulled = false; group.add(mesh); return mesh; };
  const heads = batch(new THREE.SphereGeometry(.12, 8, 6), std('#c2997b'));
  const bodies = batch(cyl(.18, .14, .55, 0, 1.14, 0, 8), std('#ffffff'));
  const limbs = Array.from({ length: 4 }, (_, i) => batch(cyl(.055, .045, .66, 0, -.33, 0, 6), std(i < 2 ? '#303b46' : '#a3a49a')));
  const shoes = batch(merge([box(.13,.10,.25,-.09,.10,.04),box(.13,.10,.25,.09,.10,.04)]), std('#262b2b'));
  for (let i = 0; i < count; i++) {
    const row = i % layout.rows, side = i % 2 ? 1 : -1;
    people.push({ z: layout.origin(row * layout.cols + 1).z + side * (DEV.D / 2 + 4) + (random() - .5) * 1.6, offset: random() * layout.siteX * 2, speed: .8 + random() * .6 });
    bodies.setColorAt(i, new THREE.Color().setHSL(random(), .24 + random() * .3, .28 + random() * .42));
    heads.setColorAt(i, new THREE.Color().setScalar(.55 + random() * .5));
  }
  const body = batch(merge([box(4.2,.9,1.8,0,.75,0),box(2.2,.7,1.6,-.2,1.5,0)]), std('#ffffff',{metalness:.45,roughness:.28}), 32);
  detailTraffic(group, body);
  for(let i=0;i<32;i++) body.setColorAt(i,new THREE.Color(['#e9e3da','#babdc1','#1c3647','#9f4631','#555b58'][i%5]));
  const o = new THREE.Object3D(), pivot = new THREE.Object3D(), matrix = new THREE.Matrix4();
  body.name = 'Residential road traffic';
  return { group, update(t) {
    for(let i=0;i<count;i++) {
      const p=people[i], span=layout.siteX/2-1, phase=(p.offset+t*p.speed)%(span*4), dir=phase<span*2?1:-1;
      o.position.set(phase<span*2?-span+phase:span*3-phase,.44,p.z); o.rotation.set(0,dir*Math.PI/2,0); o.updateMatrix();
      bodies.setMatrixAt(i,o.matrix); shoes.setMatrixAt(i,o.matrix);
      pivot.position.set(0,1.56,0); pivot.rotation.set(0,0,0); pivot.updateMatrix(); heads.setMatrixAt(i,matrix.multiplyMatrices(o.matrix,pivot.matrix));
      for(let j=0;j<4;j++) {
        pivot.position.set(j<2?(j?.095:-.095):(j===2?-.21:.21),j<2?.87:1.37,0);
        pivot.rotation.x=Math.sin(t*p.speed*5+p.offset+(j===0||j===3?0:Math.PI))*(j<2?.4:.3); pivot.updateMatrix();
        limbs[j].setMatrixAt(i,matrix.multiplyMatrices(o.matrix,pivot.matrix));
      }
    }
    for(const mesh of [heads,bodies,shoes,...limbs]) mesh.instanceMatrix.needsUpdate=true;
    for(let i=0;i<32;i++) {
      const dir=i%2?1:-1;
      const p=route.at(Math.floor(i/2)*route.length/16+t*dir*5.5,-dir*1.75);
      o.position.set(p.x,p.y,p.z); o.rotation.set(0,-Math.atan2(p.tz*dir,p.tx*dir),0); o.updateMatrix(); body.setMatrixAt(i,o.matrix);
    }
    body.instanceMatrix.needsUpdate=true;
  } };
}
